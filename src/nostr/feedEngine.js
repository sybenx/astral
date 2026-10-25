// Feed engine — a memory-bounded timeline over NDK.
//
// The 2022 feed kept every event in deep-reactive Vuex state, deep-cloned each
// event (JSON.parse(JSON.stringify)), and built nested reactive thread arrays.
// Building all those Vue proxies on first paint exhausted memory and crashed
// mobile Safari ("a problem repeatedly occurred").
//
// This engine borrows the model proven by Jumble (github.com/CodyTseng/jumble):
//   - Raw events live in a PLAIN Map, entirely outside Vue reactivity. They are
//     never wrapped in proxies, so thousands of them cost a few MB, not the tens
//     of MB reactive proxies would.
//   - The reactive surface is a shallowRef of event IDs (tiny). Only the array
//     identity is tracked; mutating it doesn't deep-convert anything.
//   - The view layer renders ids → events via getEvent() inside a virtualized
//     list, so only the on-screen slice is ever mounted in the DOM.
//   - Live events arriving while you read are buffered (not auto-prepended) and
//     surfaced via a "show new" button, avoiding scroll-jump re-renders.
//
// Net effect: continuous endless scroll with a flat memory profile. No hard cap
// is needed for memory — refs are tiny, events are plain, the DOM is bounded.

import { ref, shallowRef } from 'vue'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import ndk, { connect } from './ndk'
import { splitAuthors } from './filters'

const nowSec = () => Math.round(Date.now() / 1000)
const toRaw = (e) => (e && e.rawEvent ? e.rawEvent() : e)

// Insert id into a newest-first id array at its sorted position.
function insertDesc(ids, id, at) {
  let lo = 0
  let hi = ids.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at(ids[mid]) > at(id)) lo = mid + 1
    else hi = mid
  }
  ids.splice(lo, 0, id)
  return ids
}

/**
 * Create a feed bound to a filter.
 *
 * @param {object} opts
 * @param {number[]} opts.kinds       event kinds to subscribe (default [1])
 * @param {string[]|null} opts.authors author pubkeys, or null for global
 * @param {object|null} opts.baseFilter if set, used as the NIP-01 filter base
 *   instead of building one from kinds+authors. Useful for tag filters (#p, #t).
 * @param {string[]|null} opts.relays  explicit relay urls, or null for ndk default
 * @param {number} opts.pageSize       events per page (default 50)
 * @param {number} opts.pendingCap     max buffered live notes (default 500)
 * @param {(e:object)=>void} [opts.enrich]   mutate each event before storing (e.g. interpolate mentions)
 * @param {(e:object)=>boolean} [opts.valid] reject events that return false
 */
export function createFeed({
  kinds = [1],
  authors = null,
  baseFilter = null,
  relays = null,
  pageSize = 50,
  pendingCap = 500,
  enrich = null,
  valid = null
} = {}) {
  // ── non-reactive store (the whole point) ──────────────────────────────────
  const events = new Map() // id -> plain enriched event
  const seen = new Set() // every id ever accepted (dedup)

  // ── reactive surface (ids only; shallow) ──────────────────────────────────
  const timeline = shallowRef([]) // visible ids, newest first
  const pending = shallowRef([]) // buffered live ids, newest first
  const loading = ref(false)
  const reachedEnd = ref(false)

  let liveSub = null
  let oldestUntil = nowSec() // pagination cursor for older pages
  let newestAt = 0 // created_at of the newest event we've shown
  let started = false
  let primed = false // the first page is in, so newestAt means something
  let liveWanted = true // false while stop()ped (hidden tab, sign-in dialog up)
  let generation = 0 // bumped by destroy(), so a fetch already in flight is dropped

  const at = (id) => events.get(id)?.created_at || 0

  function rs() {
    if (relays && relays.length) {
      try {
        return NDKRelaySet.fromRelayUrls(relays, ndk)
      } catch (_) {
        return undefined
      }
    }
    return undefined
  }

  function buildFilter(extra) {
    if (baseFilter) return splitAuthors({ ...baseFilter, ...extra })
    const filter = { kinds, ...extra }
    if (authors && authors.length) filter.authors = authors
    return splitAuthors(filter) // several filters past 500 authors
  }

  // With several author chunks, each returns its own newest `limit`. Keeping
  // only the newest pageSize overall leaves no gaps: a chunk that filled its
  // limit has nothing missing above the page's oldest kept event. The rest
  // are forgotten so a later page can accept them again.
  function trimPage(collected, chunked) {
    if (!chunked || collected.length <= pageSize) return collected
    collected.sort((a, b) => b.created_at - a.created_at)
    for (const e of collected.slice(pageSize)) {
      seen.delete(e.id)
      events.delete(e.id)
    }
    return collected.slice(0, pageSize)
  }

  // Normalize, validate, enrich and store an incoming NDK event. Returns the
  // plain event on first sight, or null if duplicate/invalid.
  function accept(ndkEvent) {
    const e = toRaw(ndkEvent)
    if (!e || !e.id || seen.has(e.id)) return null
    if (valid && !valid(e)) return null
    seen.add(e.id)
    if (typeof e.replies === 'undefined') e.replies = []
    if (enrich) {
      try {
        enrich(e)
      } catch (_) {
        /* enrichment is best-effort */
      }
    }
    events.set(e.id, e)
    return e
  }

  // One-shot older-page fetch, until-paginated. Drives the subscription itself
  // and always settles (mirrors query.js collect()), since some relays never
  // send EOSE for author filters.
  function fetchPage(until) {
    return new Promise((resolve) => {
      const collected = []
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          sub.stop()
        } catch (_) {
          /* already stopped */
        }
        resolve(trimPage(collected, Array.isArray(filter)))
      }
      const filter = buildFilter({ limit: pageSize, until })
      const sub = ndk.subscribe(
        filter,
        // PARALLEL queries cache AND relays together: cached events paint instantly
        // while relays fill in fresh ones. (CACHE_FIRST can EOSE on an empty cache
        // before relays answer, yielding an empty page.)
        { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL, relaySet: rs() }
      )
      sub.on('event', (ev) => {
        const e = accept(ev)
        if (e) collected.push(e)
      })
      sub.on('eose', finish)
      const timer = setTimeout(finish, 6000)
    })
  }

  // Live tail subscription: everything newer than what we've shown goes to the
  // pending buffer. Kept open until stop()/destroy().
  function startLive() {
    if (liveSub) return
    liveSub = ndk.subscribe(
      buildFilter({ since: newestAt + 1 }),
      { closeOnEose: false, groupable: false, relaySet: rs() }
    )
    liveSub.on('event', (ev) => {
      const e = accept(ev)
      if (!e || e.created_at <= newestAt) return
      const next = insertDesc(pending.value.slice(), e.id, at)
      pending.value = next.length > pendingCap ? next.slice(0, pendingCap) : next
    })
  }

  async function start() {
    if (started) return
    started = true
    // loading is set before the connect wait (up to 2.5s), or an empty list's
    // scroll handler gets in a loadMore() ahead of the first page
    loading.value = true
    const gen = generation
    await connect()
    if (gen !== generation) return
    const page = await fetchPage(oldestUntil)
    if (gen !== generation) return
    const ids = page.map((e) => e.id).sort((a, b) => at(b) - at(a))
    timeline.value = ids
    if (ids.length) {
      newestAt = at(ids[0])
      oldestUntil = at(ids[ids.length - 1]) - 1
    }
    if (page.length < pageSize) reachedEnd.value = true
    loading.value = false
    primed = true
    if (liveWanted) startLive()
  }

  // Re-open the live tail after stop(). Before the first page is in, newestAt
  // isn't known yet, so start() opens it instead.
  function resume() {
    liveWanted = true
    if (primed) startLive()
  }

  async function loadMore() {
    if (loading.value || reachedEnd.value || !primed) return
    loading.value = true
    const gen = generation
    const page = await fetchPage(oldestUntil)
    if (gen !== generation) return
    if (page.length) {
      const older = page.map((e) => e.id).sort((a, b) => at(b) - at(a))
      timeline.value = timeline.value.concat(older)
      oldestUntil = at(timeline.value[timeline.value.length - 1]) - 1
    }
    if (page.length < pageSize) reachedEnd.value = true
    loading.value = false
  }

  // Merge the buffered live notes onto the top of the timeline.
  function showNew() {
    if (!pending.value.length) return
    timeline.value = pending.value.concat(timeline.value)
    newestAt = at(timeline.value[0])
    pending.value = []
  }

  function stop() {
    liveWanted = false
    if (liveSub) {
      try {
        liveSub.stop()
      } catch (_) {
        /* already stopped */
      }
      liveSub = null
    }
  }

  // Full reset — drop subscriptions and all stored events/ids.
  function destroy() {
    generation++
    stop()
    events.clear()
    seen.clear()
    timeline.value = []
    pending.value = []
    started = false
    primed = false
    liveWanted = true
    loading.value = false
    reachedEnd.value = false
    oldestUntil = nowSec()
    newestAt = 0
  }

  return {
    // reactive
    timeline,
    pending,
    loading,
    reachedEnd,
    // lookups & control
    getEvent: (id) => events.get(id),
    start,
    loadMore,
    showNew,
    stop,
    resume, // re-open the live tail after stop() (visibility / sign-in gating)
    destroy
  }
}
