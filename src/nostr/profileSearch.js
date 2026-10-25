// Profile search: Primal's public cache (user_search) and syb.lol's NIP-50
// search, asked in parallel. Compared on 2026-10-24 (jack, fiatjaf, odell,
// kat@x21.social, gigi, "derek ross"): Primal ranks best (the person you mean
// first) but returns nothing for multi-word names; syb.lol is fastest and finds
// those, with weaker ranking for common names. So Primal's order comes first,
// then syb.lol's extras. search.nos.today (slow, noisy) is a last resort only;
// relay.nostr.band (dead) and relay.noswhere.com (returns nothing) are gone.
//
// REQ format: ["REQ", "<id>", { cache: ["user_search", { query, limit }] }]

import ndk, { connect } from './ndk'
import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

const PRIMAL_ENDPOINTS = ['wss://cache2.primal.net/v1', 'wss://cache1.primal.net/v1']
const NIP50_PRIMARY = ['wss://syb.lol']
const NIP50_LAST_RESORT = ['wss://search.nos.today']

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
        this.pending.forEach(({ resolve: r, timer }) => {
          clearTimeout(timer)
          r([])
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
    if (type === 'EVENT' && payload && payload.kind === 0) {
      req.results.push(payload)
    } else if (type === 'EOSE') {
      clearTimeout(req.timer)
      req.resolve(req.results)
      this.pending.delete(id)
    }
  }

  async searchUsers(query, limit = 10) {
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
      }, 5000)
      this.pending.set(id, { resolve, timer, results: [] })
      this.ws.send(JSON.stringify(['REQ', id, { cache: ['user_search', { query, limit }] }]))
    })
  }
}

const primal = new PrimalCache()

function parseProfile(event) {
  try {
    const c = JSON.parse(event.content)
    return {
      pubkey: event.pubkey,
      created_at: event.created_at,
      name: c.name || c.display_name || '',
      display_name: c.display_name || c.name || '',
      picture: c.picture || '',
      nip05: c.nip05 || '',
      about: c.about || '',
      lud16: c.lud16 || '',
      lud06: c.lud06 || ''
    }
  } catch (_) {
    return null
  }
}

// NIP-50 search on the given relays; resolves with what arrived by EOSE or the timeout.
async function nip50Search(query, limit, relays, timeout) {
  await connect()
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk')
  let relaySet
  try {
    relaySet = NDKRelaySet.fromRelayUrls(relays, ndk)
  } catch (_) {
    relaySet = undefined
  }
  return new Promise((resolve) => {
    const events = new Map()
    const sub = ndk.subscribe(
      { kinds: [0], search: query, limit },
      { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, relaySet }
    )
    const finish = () => {
      try { sub.stop() } catch (_) { /* ignore */ }
      resolve([...events.values()])
    }
    sub.on('event', (e) => events.set(e.pubkey, e.rawEvent ? e.rawEvent() : e))
    sub.on('eose', finish)
    setTimeout(finish, timeout)
  })
}

// Search profiles by name / display name / nip05. Returns parsed profiles
// (newest kind-0 per pubkey): Primal's ranking first, then syb.lol's extras.
export async function searchProfiles(query, limit = 10) {
  const q = (query || '').trim()
  if (q.length < 2) return []

  const [fromPrimal, fromRelay] = await Promise.all([
    primal.searchUsers(q, limit).catch(() => []),
    nip50Search(q, limit, NIP50_PRIMARY, 3000).catch(() => []),
  ])
  let events = [...fromPrimal, ...fromRelay]
  if (!events.length) events = await nip50Search(q, limit, NIP50_LAST_RESORT, 2500).catch(() => [])

  // first appearance sets the order (Primal before syb.lol); the newest kind-0 wins the content
  const order = []
  const byPubkey = new Map()
  for (const ev of events) {
    const existing = byPubkey.get(ev.pubkey)
    if (!existing) order.push(ev.pubkey)
    if (!existing || ev.created_at > existing.created_at) byPubkey.set(ev.pubkey, ev)
  }
  return order
    .map((pk) => parseProfile(byPubkey.get(pk)))
    .filter((p) => p && !(p.nip05 && p.nip05.includes('mostr.pub')))
    .slice(0, limit + 5) // room for the extras Primal didn't have
}
