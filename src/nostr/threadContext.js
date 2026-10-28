// The posts that feed replies answer, so a reply can show under its parent
// (as in the original astral). Only mounted posts ask (the feed is virtual),
// and requests are batched: up to 50 ids per relay query, one query at a time,
// cache first. Ids already known or in flight are skipped, and so are ids not
// found in the last few minutes. Each id is also asked where the post citing it
// says to look (relay hints, its authors' relays).
import { getEventsCited } from '../query'
import * as helpersMixin from '../utils/mixin'

const BATCH = 50
const DELAY = 250 // ms to gather ids before asking
const MISSED_CAP = 2000
const RETRY_AFTER = 3 * 60 * 1000 // ms before an id not found is asked again

const wanted = new Map() // id → the post citing it
const inFlight = new Set()
const missed = new Map() // id → when it wasn't found
let timer = null
let running = false

// lookup(id) can return an event the caller already holds (the feed engine's
// own Map), which goes straight into the cache without a relay query.
// `from`: the post citing these ids.
export function wantEvents(store, ids, lookup, from) {
  for (const id of ids) {
    if (!id || id in store.state.eventsCache || inFlight.has(id)) continue
    if (Date.now() - (missed.get(id) || 0) < RETRY_AFTER) continue
    const local = lookup?.(id)
    if (local) {
      addToCache(store, local)
      continue
    }
    if (!wanted.has(id) || from) wanted.set(id, from)
  }
  schedule(store)
}

function schedule(store) {
  if (wanted.size && !timer && !running) timer = setTimeout(() => flush(store), DELAY)
}

function addToCache(store, event) {
  if (!event.interpolated) helpersMixin.default.methods.interpolateEventMentions(event, store)
  store.commit('addEventToCache', event)
  store.dispatch('useProfile', { pubkey: event.pubkey })
}

async function flush(store) {
  timer = null
  running = true
  const ids = [...wanted.keys()].slice(0, BATCH)
  const from = new Set()
  for (const id of ids) {
    if (wanted.get(id)) from.add(wanted.get(id))
    wanted.delete(id)
    inFlight.add(id)
  }
  const relays = Object.keys(store.state.relays).length
    ? Object.keys(store.state.relays)
    : Object.keys(store.state.defaultRelays)
  let events = []
  try {
    events = (await getEventsCited({ ids, relays, from: [...from] })) || []
  } catch {
    /* relays unreachable: treated as not found */
  }
  const found = new Set()
  for (const event of events) {
    if (!inFlight.has(event.id) || found.has(event.id)) continue
    if (event.kind === 1 || event.kind === 2) addToCache(store, event)
    found.add(event.id)
  }
  for (const id of ids) {
    inFlight.delete(id)
    if (found.has(id)) missed.delete(id)
    else missed.set(id, Date.now())
  }
  if (missed.size > MISSED_CAP) missed.delete(missed.keys().next().value)
  running = false
  schedule(store)
}
