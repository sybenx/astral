// NIP-65 relay lists (kind 10002) ↔ the store's { [url]: { read, write } } map,
// through NDK's NDKRelayList.

import { NDKEvent, NDKRelayList } from '@nostr-dev-kit/ndk'
import ndk from './ndk'

// NDK normalizes "wss://nos.lol" to "wss://nos.lol/"; the store and the relay
// lists in Settings use the form without the root slash.
const bare = (url) => url.replace(/^(wss?:\/\/[^/]+)\/$/, '$1')

export function relaysFromEvent(raw) {
  const list = NDKRelayList.from(new NDKEvent(ndk, raw))
  const relays = {}
  for (const url of list.readRelayUrls) relays[bare(url)] = { read: true, write: false }
  for (const url of list.writeRelayUrls) {
    const key = bare(url)
    relays[key] = { read: relays[key]?.read || false, write: true }
  }
  return relays
}

// Tags for a kind-10002 event: no marker when a relay is both read and write.
export function relayListTags(relays) {
  const tags = []
  for (const [url, { read = true, write = true } = {}] of Object.entries(relays || {})) {
    if (!/^wss?:\/\//.test(url)) continue
    if (read && write) tags.push(['r', url])
    else if (read) tags.push(['r', url, 'read'])
    else if (write) tags.push(['r', url, 'write'])
  }
  return tags
}
