// Search: wss://relay.ditto.pub and wss://syb.lol over NIP-50, the pair the
// Wisp fork settled on. Compared on 2026-10-24 (jack, fiatjaf, odell,
// kat@x21.social, gigi, "derek ross", "alex gleason"): both answer in ~200–350ms
// and find multi-word names, Ditto with the bigger index, but neither ranks —
// same-name copies with no NIP-05 come first. Primal's cache ranks well but
// errors on multi-word names, so it's kept only as a ranking helper: its order
// and its follower counts feed searchRank.js.
//
// Results stream: people you follow who match show at once, relay results are
// added as they arrive, the ranked list follows once NIP-05s and follower counts
// are in, and anything slower is added at the end rather than dropped.

import ndk, { connect } from './ndk'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import { rankProfiles, matchesQuery, verifyNip05, parseProfile, isBridged } from './searchRank'

export const SEARCH_RELAYS = ['wss://relay.ditto.pub', 'wss://syb.lol']

const PRIMAL_ENDPOINTS = ['wss://cache2.primal.net/v1', 'wss://cache1.primal.net/v1']
const RELAY_WAIT = 2500 // ms before ranking with what has arrived
const ENRICH_WAIT = 2500 // ms for NIP-05 checks and follower counts
const LATE_WAIT = 6000 // ms the relay search stays open for slow results
const FOLLOWER_COUNTS = 10000133 // Primal's kind for {pubkey: followers}

// REQ format: ["REQ", "<id>", { cache: ["user_search", { query, limit }] }]
class PrimalCache {
  constructor() {
    this.ws = null
    this.connected = false
    this.connecting = null
    this.pending = new Map()
    this.endpointIndex = 0
  }

  connect() {
    if (this.connected) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    this.connecting = new Promise((resolve) => {
      let settled = false
      const endpoint = PRIMAL_ENDPOINTS[this.endpointIndex]
      let ws
      try {
        ws = new WebSocket(endpoint)
      } catch (_) {
        this.connecting = null
        resolve(false)
        return
      }
      const to = setTimeout(() => {
        if (!settled) {
          settled = true
          try { ws.close() } catch (_) { /* ignore */ }
          this.connecting = null
          resolve(false)
        }
      }, 5000)
      ws.onopen = () => {
        settled = true
        clearTimeout(to)
        this.ws = ws
        this.connected = true
        this.connecting = null
        resolve(true)
      }
      ws.onmessage = (e) => this.handle(e.data)
      ws.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(to)
          this.connecting = null
          // try the other endpoint next time
          this.endpointIndex = (this.endpointIndex + 1) % PRIMAL_ENDPOINTS.length
          resolve(false)
        }
      }
      ws.onclose = () => {
        this.connected = false
        this.pending.forEach(({ resolve: r, timer, results }) => {
          clearTimeout(timer)
          r(results)
        })
        this.pending.clear()
      }
    })
    return this.connecting
  }

  handle(data) {
    let message
    try {
      message = JSON.parse(data)
    } catch (_) {
      return
    }
    if (!Array.isArray(message) || message.length < 2) return
    const [type, id, payload] = message
    const req = this.pending.get(id)
    if (!req) return
    if (type === 'EVENT' && payload) {
      req.results.push(payload)
    } else if (type === 'EOSE' || type === 'NOTICE') {
      clearTimeout(req.timer)
      req.resolve(req.results)
      this.pending.delete(id)
    }
  }

  async request(cache, timeout) {
    const ok = await this.connect()
    if (!ok) throw new Error('primal cache unavailable')
    const id = `astral_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const req = this.pending.get(id)
        if (req) {
          this.pending.delete(id)
          resolve(req.results)
        }
      }, timeout)
      this.pending.set(id, { resolve, timer, results: [] })
      this.ws.send(JSON.stringify(['REQ', id, { cache }]))
    })
  }

  // kind-0 events in Primal's order (Primal errors on multi-word names: [])
  async searchUsers(query, limit = 10, timeout = RELAY_WAIT) {
    const events = await this.request(['user_search', { query, limit }], timeout)
    return events.filter((e) => e.kind === 0)
  }

  // pubkey → follower count
  async followerCounts(pubkeys, timeout = ENRICH_WAIT) {
    const counts = new Map()
    if (!pubkeys.length) return counts
    const events = await this.request(['user_infos', { pubkeys }], timeout)
    for (const e of events) {
      if (e.kind !== FOLLOWER_COUNTS) continue
      try {
        for (const [pk, n] of Object.entries(JSON.parse(e.content))) counts.set(pk, Number(n) || 0)
      } catch (_) { /* skip */ }
    }
    return counts
  }
}

const primal = new PrimalCache()

function relaySet(urls) {
  try {
    return NDKRelaySet.fromRelayUrls(urls, ndk)
  } catch (_) {
    return undefined
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Search profiles by name. Resolves with the ranked list; onResults is called
 * with each better list as it comes in (including slow results added later).
 *
 * @param {string} query
 * @param {object} opts
 * @param {number} [opts.limit]
 * @param {string[]} [opts.follows]       the viewer's follows
 * @param {object} [opts.cached]          pubkey → profile already known (Vuex profilesCache)
 * @param {(pubkey:string)=>boolean} [opts.hidden] drop muted / blocked accounts
 * @param {(profiles:object[])=>void} [opts.onResults]
 * @param {AbortSignal} [opts.signal]     stop when a newer search starts
 */
export async function searchProfiles(query, { limit = 10, follows = [], cached = {}, hidden = null, onResults = null, signal = null } = {}) {
  const q = (query || '').trim()
  if (q.length < 2) return []

  const followSet = new Set(follows)
  const profiles = new Map() // pubkey → newest parsed profile
  const verified = new Map()
  const followers = new Map()
  const primalRank = new Map()
  const late = [] // pubkeys that arrived after the ranked list went out
  let ranked = null
  let emitTimer = null

  const keep = (p) => p && !isBridged(p) && !(hidden && hidden(p.pubkey)) && matchesQuery(p, q)
  const add = (p) => {
    if (!keep(p)) return false
    const old = profiles.get(p.pubkey)
    if (old && old.created_at >= p.created_at) return false
    profiles.set(p.pubkey, p)
    if (!old && ranked) late.push(p.pubkey)
    return true
  }
  const list = () => {
    const all = [...profiles.values()]
    const signals = { follows: followSet, verified, followers, primalRank }
    if (!ranked) return rankProfiles(all, q, signals).slice(0, limit + 5)
    const lateSet = new Set(late)
    const head = rankProfiles(all.filter((p) => !lateSet.has(p.pubkey)), q, signals).slice(0, limit + 5)
    return head.concat(late.map((pk) => profiles.get(pk)))
  }
  const emit = () => {
    clearTimeout(emitTimer)
    emitTimer = null
    if (!signal?.aborted && onResults) onResults(list())
  }
  const emitSoon = () => {
    if (!emitTimer) emitTimer = setTimeout(emit, 150)
  }

  // 1. people you follow, from profiles already loaded
  for (const pk of follows) {
    const p = cached[pk]
    if (p && matchesQuery(p, q)) add({ ...p, pubkey: pk, created_at: p.created_at || 0 })
  }
  if (profiles.size) emit()

  // 2. relays, streaming
  await connect()
  if (signal?.aborted) return []
  let relaysDone
  const relaysAnswered = new Promise((r) => (relaysDone = r))
  const sub = ndk.subscribe(
    { kinds: [0], search: q, limit: 20 },
    // exclusiveRelay: without it NDK 2.18 also hands this subscription every
    // kind-0 seen on any relay (its matcher ignores `search`)
    { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, relaySet: relaySet(SEARCH_RELAYS), exclusiveRelay: true }
  )
  const stopSub = () => {
    try { sub.stop() } catch (_) { /* ignore */ }
  }
  sub.on('event', (e) => {
    if (add(parseProfile(e.rawEvent ? e.rawEvent() : e))) emitSoon()
  })
  sub.on('eose', () => relaysDone())
  setTimeout(stopSub, LATE_WAIT)
  signal?.addEventListener('abort', stopSub)

  // Primal's ranking, as a hint (and a source for anything the relays lack)
  const primalDone = primal.searchUsers(q, limit).then((events) => {
    events.forEach((e, i) => {
      if (!primalRank.has(e.pubkey)) primalRank.set(e.pubkey, i)
      add(parseProfile(e))
    })
  }).catch(() => {})

  await Promise.race([Promise.all([relaysAnswered, primalDone]), sleep(RELAY_WAIT)])
  if (signal?.aborted) return []
  emit()

  // 3. follower counts for every candidate (one request: same-name copies tie
  // on name, so the real account can sit past any cut-off) and NIP-05 checks,
  // then the ranked list
  const all = [...profiles.values()]
  const candidates = list().filter((p) => p.nip05).slice(0, 20)
  await Promise.race([
    Promise.all([
      primal.followerCounts(all.map((p) => p.pubkey).slice(0, 100))
        .then((counts) => counts.forEach((n, pk) => followers.set(pk, n)))
        .catch(() => {}),
      ...candidates.map((p) =>
        verifyNip05(p.nip05, p.pubkey, ENRICH_WAIT).then((ok) => verified.set(p.pubkey, ok))
      ),
    ]),
    sleep(ENRICH_WAIT),
  ])
  if (signal?.aborted) return []
  const result = list()
  ranked = true
  emit()
  return result
}

// Posts matching text over NIP-50, newest first (e.g. a profile's "search posts").
export async function searchNotes(query, { authors = null, limit = 50, timeout = 4000 } = {}) {
  const q = (query || '').trim()
  if (!q) return []
  await connect()
  const filter = { kinds: [1], search: q, limit }
  if (authors?.length) filter.authors = authors
  return new Promise((resolve) => {
    const events = new Map()
    const sub = ndk.subscribe(filter, {
      closeOnEose: true,
      groupable: false,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
      relaySet: relaySet(SEARCH_RELAYS),
      exclusiveRelay: true,
    })
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try { sub.stop() } catch (_) { /* ignore */ }
      resolve([...events.values()].sort((a, b) => b.created_at - a.created_at))
    }
    sub.on('event', (e) => {
      const raw = e.rawEvent ? e.rawEvent() : e
      events.set(raw.id, raw)
    })
    sub.on('eose', finish)
    setTimeout(finish, timeout)
  })
}
