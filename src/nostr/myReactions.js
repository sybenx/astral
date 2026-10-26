// Your own reactions (kind 7) to the posts on screen, from relays, so the heart
// shows for posts you liked earlier, here or in another app. Posts ask as they
// mount; the ids are batched into one request (authors: you, #e: the posts)
// on your NIP-65 write relays plus the defaults. Each post is checked once per
// session.

import { reactive } from 'vue'
import ndk, { connect, DEFAULT_RELAYS } from './ndk'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

// owner: whose reactions these are. byId: event id → { content, tags } of
// their newest reaction, or null (checked, none). Read through myReactionFor,
// so another account's reactions never show after switching.
export const myReactions = reactive({ owner: null, byId: {} })

const BATCH = 150
const DELAY = 300
const TIMEOUT = 5000

let queue = new Set()
let asked = new Set() // queued or in flight
let timer = null
const waiters = new Map() // event id → [resolve…] until its batch is answered

function reset(pubkey) {
  myReactions.owner = pubkey
  myReactions.byId = {}
  queue = new Set()
  asked = new Set()
  clearTimeout(timer)
  timer = null
}

function relaysFor(store) {
  const own = Object.entries(store.state.relays || {})
    .filter(([url, o]) => /^wss?:\/\//.test(url) && o?.write !== false)
    .map(([url]) => url)
  return [...new Set([...own, ...DEFAULT_RELAYS])]
}

// NIP-25: the reacted-to event is the last `e` tag.
const target = (e) => [...(e.tags || [])].reverse().find((t) => t[0] === 'e' && t[1])?.[1]

async function run(store, ids) {
  await connect()
  const me = store.state.keys.pub
  const found = new Map()
  await new Promise((resolve) => {
    let rs
    try { rs = NDKRelaySet.fromRelayUrls(relaysFor(store), ndk) } catch { rs = undefined }
    const sub = ndk.subscribe(
      { kinds: [7], authors: [me], '#e': ids },
      { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL, relaySet: rs }
    )
    sub.on('event', (e) => {
      const id = target(e)
      if (!id || !ids.includes(id) || e.pubkey !== me) return
      const prev = found.get(id)
      if (!prev || e.created_at > prev.created_at) found.set(id, e)
    })
    const done = () => { try { sub.stop() } catch { /* stopped */ } resolve() }
    sub.on('eose', done)
    setTimeout(done, TIMEOUT)
  })
  if (myReactions.owner !== me) return // signed out or switched meanwhile
  for (const id of ids) {
    const e = found.get(id)
    myReactions.byId[id] = e ? { content: e.content || '+', tags: e.tags || [] } : (myReactions.byId[id] ?? null)
    for (const resolve of waiters.get(id) || []) resolve()
    waiters.delete(id)
  }
}

function flush(store) {
  timer = null
  const ids = [...queue]
  queue = new Set()
  for (let i = 0; i < ids.length; i += BATCH) run(store, ids.slice(i, i + BATCH)).catch(() => {})
}

// Ask about one post; resolves once it's known (or the request timed out).
export function checkMyReaction(store, id) {
  const me = store.state.keys.pub
  if (!me || !id) return Promise.resolve()
  if (myReactions.owner !== me) reset(me)
  if (id in myReactions.byId) return Promise.resolve()
  const p = new Promise((resolve) => {
    if (!waiters.has(id)) waiters.set(id, [])
    waiters.get(id).push(resolve)
    setTimeout(resolve, TIMEOUT + DELAY + 500)
  })
  if (!asked.has(id)) {
    asked.add(id)
    queue.add(id)
    if (!timer) timer = setTimeout(() => flush(store), DELAY)
  }
  return p
}

// Your reaction to a post: an object, null (none) or undefined (not checked yet).
export function myReactionFor(store, id) {
  return myReactions.owner === store.state.keys.pub ? myReactions.byId[id] : undefined
}

// After sending one here.
export function setMyReaction(store, id, content = '+', tags = []) {
  if (myReactions.owner !== store.state.keys.pub) reset(store.state.keys.pub)
  myReactions.byId[id] = { content, tags }
}
