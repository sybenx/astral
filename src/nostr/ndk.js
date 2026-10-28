// NDK singleton — the nostr core that replaced the 2022 hand-rolled
// relay/db/query Web Worker pool (relay workers + sql.js). One NDK instance
// owns relay connections, an IndexedDB (Dexie) cache, and the active signer.
//
// Ported from the zapcooking nostr.ts pattern, trimmed for astral.

import NDK, { NDKEvent, NDKRelaySet, NDKRelayAuthPolicies } from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie'
import { schedulePrune } from './cachePrune'
import { LocalStorage } from 'quasar'

// Default relays (store/state.js builds its default and optional lists from
// these): broadly reachable relays the rest of the nostr ecosystem leans on.
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub',
  'wss://relay.nos.social'
]

// Well-known relays offered in Settings (and preferred when astral has to go
// looking through someone's relay list).
export const OPTIONAL_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub',
  'wss://relay.nos.social',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://relay.nostr.wirednet.jp',
]

// Outbox/discovery relays used for resolving profiles and relay lists.
export const OUTBOX_RELAYS = ['wss://purplepag.es', 'wss://user.kindpag.es'] // relay.nostr.band is gone

function storedRelayUrls() {
  // The legacy Vuex layer persists relays as { [url]: {read, write} }.
  const relays = LocalStorage.getItem('relays')
  if (relays && typeof relays === 'object') {
    const urls = Object.keys(relays).filter((u) => /^wss?:\/\//.test(u))
    if (urls.length) return urls
  }
  return DEFAULT_RELAYS
}

const cacheAdapter =
  typeof indexedDB !== 'undefined'
    ? new NDKCacheAdapterDexie({ dbName: 'astral-ndk-cache' })
    : undefined

const ndk = new NDK({
  explicitRelayUrls: storedRelayUrls(),
  outboxRelayUrls: OUTBOX_RELAYS,
  enableOutboxModel: true,
  autoConnectUserRelays: true,
  autoFetchUserMutelist: false,
  cacheAdapter
})

if (cacheAdapter) schedulePrune(() => ndk.activeUser?.pubkey || null)

// NIP-42: many relays (damus, nostr.wine, most DM inbox relays) only hand out
// DMs to the person who signs their login challenge. Answer it with whatever
// signs for you; NDK then re-runs what the relay refused. Only the relays your
// DMs live on get a login — the defaults, your relays, your DM inbox relays —
// not every relay the outbox model reaches, so a phone signer isn't asked over
// and over. A relay asks once, as soon as it connects, which is often before
// the signer is back (Cosign, an extension) or before we know the relay holds
// your DMs: the answer waits for both, for as long as that connection lasts.
const bareUrl = (u) => (u || '').replace(/\/+$/, '').toLowerCase()
const loginRelays = new Set(DEFAULT_RELAYS.map(bareUrl))
const loginWaiters = new Set()
const recheckLogins = () => [...loginWaiters].forEach((check) => check())
export function allowRelayLogin(urls = []) {
  for (const u of urls) if (/^wss?:\/\//.test(u || '')) loginRelays.add(bareUrl(u))
  recheckLogins()
}
ndk.on('signer:ready', recheckLogins)
function loginAllowed(relay) {
  const ready = () => !!ndk.signer && loginRelays.has(bareUrl(relay.url))
  if (ready()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok) => {
      loginWaiters.delete(check)
      relay.off?.('disconnect', gone)
      resolve(ok)
    }
    const check = () => { if (ready()) done(true) }
    const gone = () => done(false)
    loginWaiters.add(check)
    relay.once?.('disconnect', gone)
  })
}
const signInToRelay = NDKRelayAuthPolicies.signIn({ ndk })
ndk.relayAuthDefaultPolicy = async (relay, challenge) => {
  if (!(await loginAllowed(relay))) return false
  try {
    return await signInToRelay(relay, challenge)
  } catch (err) {
    console.warn('[ndk] relay login failed', relay.url, err?.message || err)
    return false
  }
}

let connectPromise = null

// Connect once; subsequent callers await the same promise. NDK keeps relay
// connections alive and reconnects on its own afterward.
export function connect() {
  if (!connectPromise) {
    connectPromise = ndk.connect(2500).catch((err) => {
      console.error('[ndk] connect failed', err)
    })
  }
  return connectPromise
}

// Add relays to the live pool (e.g. the user's NIP-65 set) so subsequent
// subscriptions and publishes can use them.
export function addRelays(urls = []) {
  for (const url of urls) {
    if (!/^wss?:\/\//.test(url)) continue
    try {
      ndk.addExplicitRelay(url)
    } catch (err) {
      console.warn('[ndk] could not add relay', url, err)
    }
  }
}

// Build an NDKRelaySet from explicit URLs (used when callers pass a relays list,
// mirroring the old worker API), falling back to the pool's default set.
export function relaySetFrom(urls) {
  if (urls && urls.length) {
    return NDKRelaySet.fromRelayUrls(urls, ndk)
  }
  return undefined
}

export { ndk, NDKEvent }
export default ndk
