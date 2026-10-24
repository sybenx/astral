// The posts that feed replies answer, so a reply can show under its parent
// (as in the original astral). Only mounted posts ask (the feed is virtual),
// and requests are batched: up to 50 ids per relay query, one query at a time,
// cache first. Ids already known, in flight, or not found before are skipped.
import { getEvents } from '../query'
import * as helpersMixin from '../utils/mixin'

const BATCH = 50
const DELAY = 250 // ms to gather ids before asking
const MISSED_CAP = 2000

const wanted = new Set()
const inFlight = new Set()
const missed = new Set()
let timer = null
let running = false

// lookup(id) can return an event the caller already holds (the feed engine's
// own Map), which goes straight into the cache without a relay query.
export function wantEvents(store, ids, lookup) {
  for (const id of ids) {
    if (!id || id in store.state.eventsCache || inFlight.has(id) || missed.has(id)) continue
    const local = lookup?.(id)
    if (local) {
      addToCache(store, local)
      continue
    }
    wanted.add(id)
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
  const ids = [...wanted].slice(0, BATCH)
  for (const id of ids) {
    wanted.delete(id)
    inFlight.add(id)
  }
  const relays = Object.keys(store.state.relays).length
    ? Object.keys(store.state.relays)
    : Object.keys(store.state.defaultRelays)
  let events = []
  try {
    events = (await getEvents({ ids, relays })) || []
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
    if (!found.has(id)) missed.add(id)
  }
  if (missed.size > MISSED_CAP) missed.delete(missed.values().next().value)
  running = false
  schedule(store)
}
