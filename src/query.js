// NDK-backed reimplementation of the old worker query facade.
//
// The original query.js spawned query.worker.js (which drove relay.worker.js +
// a sql.js cache over a MessageChannel). This module keeps the exact same
// exported surface — same function names, argument shapes, return contracts,
// and the { update, cancel } stream handle — but services everything through
// the single NDK instance in src/nostr/ndk.js. That lets the legacy Vuex store
// and all existing components keep working unchanged while the data layer is
// modernized underneath them.
//
// Contracts preserved from the worker API:
//   - call-style fns resolve to an array of plain events (or a single
//     event / number where the old code expected that).
//   - stream-style fns take (settings, cb, eoseCb), invoke cb with an ARRAY of
//     events per emission, eoseCb once on EOSE, and return { update, cancel }.

import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import ndk, { connect, NDKEvent, DEFAULT_RELAYS, OPTIONAL_RELAYS, OUTBOX_RELAYS } from './nostr/ndk'
import { splitAuthors } from './nostr/filters'
import { relaysFromEvent } from './nostr/relayList'

const now = () => Math.round(Date.now() / 1000)

function toRaw(ndkEvent) {
  return ndkEvent.rawEvent ? ndkEvent.rawEvent() : ndkEvent
}

function relaySet(relays) {
  if (relays && relays.length) {
    try {
      return NDKRelaySet.fromRelayUrls(relays, ndk)
    } catch (_) {
      return undefined
    }
  }
  return undefined
}

// Collect events from a one-shot subscription, resolving on EOSE OR after a
// timeout. NDK's fetchEvents() can hang indefinitely for some filters (still so
// in 2.18: a #p query gave no answer after 15s on 2026-10-24)
// (notably tag filters like #p) when a relay never sends EOSE, which left pages
// like Notifications blank. Driving the subscription ourselves guarantees the
// promise always settles with whatever arrived.
// `untilAll`: ignore EOSE and wait for every id (or the timeout). NDK reports
// EOSE once the quick relays are done, before fresh connections answer.
function collect(filter, relays, { timeout = 4000, cacheUsage = NDKSubscriptionCacheUsage.CACHE_FIRST, untilAll = false } = {}) {
  return new Promise((resolve) => {
    const events = new Map()
    let settled = false
    // `eose` on the result: relays finished answering (true) or the timeout hit (false)
    const finish = (eose = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sub.stop()
      } catch (_) {
        /* already stopped */
      }
      const result = [...events.values()]
      result.eose = eose
      resolve(result)
    }
    const sub = ndk.subscribe(
      splitAuthors(filter),
      { closeOnEose: true, groupable: false, cacheUsage, relaySet: relaySet(relays) }
    )
    sub.on('event', (event) => {
      const raw = toRaw(event)
      if (raw && raw.id) events.set(raw.id, raw)
      // asked for by id and all of them here: no need to wait on slow relays
      if (filter.ids && filter.ids.every((id) => events.has(id))) finish(true)
    })
    if (!untilAll) sub.on('eose', () => finish(true))
    const timer = setTimeout(() => finish(false), timeout)
  })
}

// One-shot fetch → array of plain events.
async function fetchMany(filter, relays, opts) {
  await connect()
  return collect(filter, relays, opts)
}

// One-shot fetch → single (newest) plain event or null.
async function fetchOne(filter, relays, opts) {
  await connect()
  const events = await collect(filter, relays, opts)
  if (!events.length) return null
  return events.reduce((newest, e) => (e.created_at > newest.created_at ? e : newest))
}

// Profile/relay-list reads must reflect the newest event, not a stale cached
// one. PARALLEL queries cache AND relays together so a newer kind-0 / kind-10002
// on a relay wins over an old copy sitting in the Dexie cache.
const FRESH = { cacheUsage: NDKSubscriptionCacheUsage.PARALLEL }

// Generic live subscription that matches the old stream() contract. filterFn
// maps a settings object to { filter, relays }.
function makeStream(filterFn) {
  return function (settings = {}, cb, eoseCb) {
    // callers pass null for "no callback"; a default parameter only covers undefined
    if (typeof cb !== 'function') cb = () => {}
    if (typeof eoseCb !== 'function') eoseCb = () => {}
    let sub = null

    const start = (s) => {
      const { filter, relays } = filterFn(s)
      const subscription = ndk.subscribe(
        splitAuthors(filter),
        { closeOnEose: false, groupable: false, relaySet: relaySet(relays) }
      )
      subscription.on('event', (event) => {
        try {
          cb([toRaw(event)])
        } catch (err) {
          console.error('[query] stream cb error', err)
        }
      })
      subscription.on('eose', () => eoseCb())
      return subscription
    }

    connect().then(() => {
      sub = start(settings)
    })

    return {
      update(newSettings) {
        if (sub) sub.stop()
        sub = start(newSettings || settings)
      },
      cancel() {
        if (sub) sub.stop()
        sub = null
      }
    }
  }
}

// ── relay status / publish ───────────────────────────────────────────────

export async function getRelayStatus() {
  await connect()
  const status = {}
  ndk.pool.relays.forEach((relay, url) => {
    status[url] = { status: relay.status, connected: relay.connectivity?.connected ?? false }
  })
  return status
}

export async function publish(event, relays) {
  await connect()
  const ndkEvent = new NDKEvent(ndk, event)
  try {
    const published = await ndkEvent.publish(relaySet(relays))
    // NDK returns a Set of relays the event reached.
    return published ? published.size || true : false
  } catch (err) {
    console.error('[query] publish failed', err)
    return false
  }
}

// ── one-shot fetches (call-style) ──────────────────────────────────────────

export async function getFeed(settings = {}) {
  const { authors, limit = 10, relays, since = 0, until = now() } = settings
  const filter = { kinds: [1, 2], limit, until }
  if (since) filter.since = since
  if (authors?.length) filter.authors = authors
  return fetchMany(filter, relays)
}

export async function getProfiles(settings = {}) {
  const { authors, relays } = settings
  const filter = { kinds: [0] }
  if (authors?.length) filter.authors = authors
  return fetchMany(filter, relays, FRESH)
}

export async function getEvents(settings = {}) {
  const { ids, relays } = settings
  if (!ids?.length) return []
  return fetchMany({ ids }, relays)
}

// Where the posts citing an id say to look for it: the relay hints in their
// e/q tags, and its author (the tag's pubkey, else the people they tag).
function citedHints(ids, from) {
  const relays = new Set()
  const authors = new Set()
  for (const event of from) {
    let noPubkey = false
    for (const [t, v, relay, , pubkey] of event?.tags || []) {
      if ((t !== 'e' && t !== 'q') || !ids.includes(v)) continue
      if (/^wss?:\/\//.test(relay || '')) relays.add(relay)
      if (/^[0-9a-f]{64}$/.test(pubkey || '')) authors.add(pubkey)
      else noPubkey = true
    }
    if (!noPubkey) continue
    authors.add(event.pubkey)
    const people = (event.tags || []).filter(([t, v]) => t === 'p' && /^[0-9a-f]{64}$/.test(v || ''))
    for (const [, v] of people.slice(0, 5)) authors.add(v)
  }
  return { relays: [...relays], authors: [...authors] }
}

// Old relay lists are mostly dead relays, with the live ones anywhere in them,
// and opening dozens of connections at once holds up the live ones. Take from
// each author in turn, relays astral knows first, and only so many.
const MAX_EXTRA = 20

// The relays these people publish to (NIP-65 write relays).
async function writeRelaysOf(authors) {
  if (!authors.length) return []
  const lists = await collect(
    { kinds: [10002], authors },
    [...OUTBOX_RELAYS, ...DEFAULT_RELAYS],
    { ...FRESH, timeout: 4000 }
  )
  const newest = new Map()
  for (const e of lists) if (!newest.has(e.pubkey) || e.created_at > newest.get(e.pubkey).created_at) newest.set(e.pubkey, e)
  const perAuthor = [...newest.values()].map((e) =>
    Object.entries(relaysFromEvent(e)).filter(([url, { write }]) => write && /^wss:\/\//.test(url)).map(([url]) => url))
  const urls = []
  for (let i = 0; perAuthor.some((list) => i < list.length); i++) {
    for (const list of perAuthor) if (i < list.length) urls.push(list[i])
  }
  return urls
}

const bareRelay = (u) => (u || '').replace(/\/+$/, '').toLowerCase()

// Posts that others point at (a reply's parent, its thread's root) often sit on
// relays you don't use. Ask yours, the relays the citing posts name and
// astral's defaults at once; whatever is still missing, ask the named relays
// again and where its authors publish, giving those time to connect.
// `from`: the posts that cite these ids.
export async function getEventsCited(settings = {}) {
  const { ids, relays = [], from = [] } = settings
  if (!ids?.length) return []
  await connect()
  const hints = citedHints(ids, from)
  const outbox = writeRelaysOf(hints.authors).catch(() => [])
  const first = [...new Map([...relays, ...hints.relays, ...DEFAULT_RELAYS].map((u) => [bareRelay(u), u])).values()]
  const found = new Map()
  const take = (events) => { for (const e of events) if (ids.includes(e.id)) found.set(e.id, e) }
  take(await collect({ ids }, first))
  const missing = ids.filter((id) => !found.has(id))
  if (!missing.length) return [...found.values()]
  const known = new Set([...relays, ...DEFAULT_RELAYS].map(bareRelay))
  const familiar = new Set(OPTIONAL_RELAYS.map(bareRelay))
  const outboxUrls = await outbox
  const ranked = [
    ...hints.relays,
    ...outboxUrls.filter((u) => familiar.has(bareRelay(u))),
    ...outboxUrls.filter((u) => !familiar.has(bareRelay(u))),
  ]
  const extra = [...new Map(ranked.filter((u) => !known.has(bareRelay(u))).map((u) => [bareRelay(u), u])).values()]
  if (extra.length) take(await collect({ ids: missing }, extra.slice(0, MAX_EXTRA), { timeout: 6000, untilAll: true }))
  return [...found.values()]
}

export async function getNotes(settings = {}) {
  const { authors, limit = 10, until = now(), since, relays } = settings
  return fetchMany({ kinds: [1], authors, limit, until, ...(since ? { since } : {}) }, relays)
}

// ── live subscriptions (stream-style) ──────────────────────────────────────

export const streamMainProfilesFollows = makeStream(({ authors, relays, user }) => ({
  // Profiles (kind 0) for everyone we follow, but contact lists (kind 3) only
  // for the current user. Requesting kind 3 for every follow streamed each
  // follow's entire (potentially huge, thousands of tags) contact list into
  // memory continuously — events the handler discards anyway — which exhausted
  // memory and crashed mobile clients for accounts with many follows.
  filter: [
    { kinds: [0], authors },
    ...(user ? [{ kinds: [3], authors: [user] }] : []),
  ],
  relays
}))

export const streamMainMentions = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [1], '#p': authors, limit },
  relays
}))

export const streamMainIncomingMessages = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [4], '#p': authors, limit },
  relays
}))

export const streamMainOutgoingMessages = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [4], authors, limit },
  relays
}))

export const streamPeerIncomingMessages = makeStream(({ authors, peers, relays, limit = 500 }) => ({
  filter: { kinds: [4], '#p': authors, authors: peers, limit },
  relays
}))

export const streamPeerOutgoingMessages = makeStream(({ authors, peers, relays, limit = 500 }) => ({
  filter: { kinds: [4], authors, '#p': peers, limit },
  relays
}))

export const streamProfile = makeStream(({ authors, relays }) => ({
  filter: { kinds: [0], authors },
  relays
}))

export const dbStreamEvent = makeStream(({ ids, relays }) => ({
  filter: { ids },
  relays
}))

export const dbStreamFollows = makeStream(({ author, relays }) => ({
  filter: { kinds: [3], authors: [author] },
  relays
}))

// Followers are kind-3 contact lists tagging the user. Those events are large
// (each carries the follower's entire follow list — often thousands of tags), so
// an unbounded query floods memory and crashes mobile. Cap it; the count is
// necessarily approximate on nostr anyway.
export const dbStreamFollowers = makeStream(({ author, relays, limit = 300 }) => ({
  filter: { kinds: [3], '#p': [author], limit },
  relays
}))

export const dbStreamTagKind = makeStream(({ type, values, kinds, limit = 500, relays }) => ({
  filter: { ['#' + type]: values, kinds, limit },
  relays
}))

// ── cache-style reads (db*) ────────────────────────────────────────────────
// These read cache-first and fall back to relays, returning the same shapes
// the sql.js-backed worker did.

export async function dbSave(/* event */) {
  // NDK's cache adapter persists events seen on subscriptions automatically;
  // explicit saves are a no-op kept for call-site compatibility.
  return true
}

export async function dbEvent(id) {
  return fetchOne({ ids: [id] })
}

export async function dbProfile(pubkey) {
  return fetchOne({ kinds: [0], authors: [pubkey] }, undefined, FRESH)
}

export async function dbFollows(pubkey) {
  return fetchMany({ kinds: [3], authors: [pubkey], limit: 1 })
}

// A NIP-51 replaceable list (bookmarks 10003, mutes 10000), newest wins.
// `answered` says whether the relays finished replying, so "no list yet" can
// be told from "no answer".
export async function dbReplaceableList(kind, pubkey, relays) {
  await connect()
  const events = await collect({ kinds: [kind], authors: [pubkey] }, relays, { ...FRESH, timeout: 6000 })
  const event = events.reduce((newest, e) => (!newest || e.created_at > newest.created_at ? e : newest), null)
  return { event, answered: events.eose === true }
}

export const dbBookmarkList = (pubkey, relays) => dbReplaceableList(10003, pubkey, relays)
export const dbMuteList = (pubkey, relays) => dbReplaceableList(10000, pubkey, relays)

// NIP-65 relay list (kind 10002) — newest wins.
export async function dbRelayList(pubkey) {
  return fetchOne({ kinds: [10002], authors: [pubkey] }, undefined, FRESH)
}

// Same, with `answered`: the relays finished replying, so "no list" is known
// rather than "no answer" (publishing over an unknown list would replace it).
export async function dbRelayListConfirmed(pubkey) {
  await connect()
  const events = await collect({ kinds: [10002], authors: [pubkey] }, undefined, { ...FRESH, timeout: 6000 })
  const event = events.reduce((newest, e) => (!newest || e.created_at > newest.created_at ? e : newest), null)
  return { event, answered: events.eose === true || !!event }
}

export async function dbChats(pubkey) {
  // Conversation summaries (the old SQL aggregation): one entry per peer with
  // the latest message timestamp. Inbox renders { peer, lastMessage }.
  const incoming = await fetchMany({ kinds: [4], '#p': [pubkey], limit: 500 })
  const outgoing = await fetchMany({ kinds: [4], authors: [pubkey], limit: 500 })

  const latestByPeer = new Map()
  const consider = (peer, ts) => {
    if (!peer || peer === pubkey) return
    const cur = latestByPeer.get(peer)
    if (cur === undefined || ts > cur) latestByPeer.set(peer, ts)
  }
  // incoming: the sender is the peer
  for (const ev of incoming) consider(ev.pubkey, ev.created_at)
  // outgoing: the recipient (#p tag) is the peer
  for (const ev of outgoing) {
    const pTag = (ev.tags || []).find(([t]) => t === 'p')
    consider(pTag && pTag[1], ev.created_at)
  }

  return [...latestByPeer.entries()]
    .map(([peer, lastMessage]) => ({ peer, lastMessage }))
    .sort((a, b) => b.lastMessage - a.lastMessage)
}

export async function dbMessages(userPubkey, peerPubkey, limit = 50, until = now()) {
  const events = await fetchMany({
    kinds: [4],
    authors: [userPubkey, peerPubkey],
    '#p': [userPubkey, peerPubkey],
    until,
    limit
  })
  return events.sort((a, b) => a.created_at - b.created_at)
}

export async function dbMentions(pubkey, limit = 40, until = now()) {
  const events = await fetchMany({ kinds: [1], '#p': [pubkey], until, limit })
  return events.sort((a, b) => b.created_at - a.created_at)
}

