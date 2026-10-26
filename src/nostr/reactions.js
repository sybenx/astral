import ndk from './ndk'
import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

const CACHE_ONLY = { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_CACHE }

// Fetch kind-7 reactions for an event from the local Dexie cache only.
// No relay round-trip — fast enough to call on every visible post at mount.
export function fetchReactionsFromCache(eventId) {
  return new Promise((resolve) => {
    const events = new Map()
    const sub = ndk.subscribe({ kinds: [7], '#e': [eventId] }, CACHE_ONLY)
    sub.on('event', (e) => {
      if (e.id && e.pubkey) events.set(e.id, { id: e.id, pubkey: e.pubkey, content: e.content || '+' })
    })
    sub.on('eose', () => resolve([...events.values()]))
    setTimeout(() => resolve([...events.values()]), 300)
  })
}
