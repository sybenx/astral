// NIP-17 private messages, next to the original kind-4 (NIP-04) DMs.
//
// Reading: gift wraps (kind 1059) addressed to you, from your DM inbox relays
// (kind 10050; otherwise your read relays and the defaults), unwrap to a signed
// seal (kind 13) and then to the message itself (an unsigned kind 14 "rumor").
// Unwrapping takes two NIP-44 decrypts, which a phone signer does over the
// network, so each message is unwrapped once and kept on this device
// (IndexedDB, per account). Messages show in the same inbox and conversations
// as kind-4 ones, as plain events with `text` already set.
//
// Sending: when the other person has an inbox list, the message goes out as
// NIP-17 (wrapped for them, and for you so your other apps see it); otherwise
// the caller sends kind 4 as before.

import { reactive } from 'vue'
import { generateSecretKey, finalizeEvent, getEventHash, verifyEvent } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import ndk, { connect, DEFAULT_RELAYS, allowRelayLogin } from './ndk'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import { nip44EncryptTo, nip44DecryptFrom } from './encryptionService'
import { signAsynchronously } from '../utils/event'
import { publish } from '../query'

const LOOKUP_RELAYS = ['wss://purplepag.es', 'wss://user.kindpag.es']
const TWO_DAYS = 2 * 24 * 60 * 60

// owner: whose messages these are. byId: rumor id → message event. version
// bumps on every change, for the pages to watch.
export const nip17State = reactive({ owner: null, version: 0, failed: 0 })
let byId = new Map()
let wrapsSeen = new Set()
let sub = null

const nowSec = () => Math.floor(Date.now() / 1000)
const randomPast = () => nowSec() - Math.floor(Math.random() * TWO_DAYS)

function relaySet(urls) {
  try { return NDKRelaySet.fromRelayUrls(urls, ndk) } catch { return undefined }
}

// ── the other side's inbox relays (kind 10050) ─────────────────────────────
const inboxCache = new Map() // pubkey → Promise<string[]>

export function inboxRelays(pubkey, extraRelays = []) {
  if (!inboxCache.has(pubkey)) {
    inboxCache.set(pubkey, (async () => {
      await connect()
      return new Promise((resolve) => {
        let newest = null
        const s = ndk.subscribe(
          { kinds: [10050], authors: [pubkey] },
          { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL, relaySet: relaySet([...new Set([...LOOKUP_RELAYS, ...DEFAULT_RELAYS, ...extraRelays])]) }
        )
        s.on('event', (e) => { if (!newest || e.created_at > newest.created_at) newest = e })
        let finished = false
        const done = (answered) => {
          if (finished) return
          finished = true
          try { s.stop() } catch { /* stopped */ }
          // no relay answered in time: ask again next time rather than remember "none"
          if (!answered && !newest) inboxCache.delete(pubkey)
          resolve((newest?.tags || []).filter((t) => t[0] === 'relay' && /^wss?:\/\//.test(t[1] || '')).map((t) => t[1]))
        }
        s.on('eose', () => done(true))
        setTimeout(() => done(false), 4000)
      })
    })())
  }
  return inboxCache.get(pubkey)
}

// ── local store of unwrapped messages (IndexedDB) ──────────────────────────
const DB = 'astral-dm'
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('rumors')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function loadCached(owner) {
  try {
    const db = await idb()
    return await new Promise((resolve) => {
      const r = db.transaction('rumors').objectStore('rumors').get(owner)
      r.onsuccess = () => resolve(r.result || { wraps: [], rumors: [] })
      r.onerror = () => resolve({ wraps: [], rumors: [] })
    })
  } catch {
    return { wraps: [], rumors: [] }
  }
}
let saveTimer = null
function saveSoon(owner) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (nip17State.owner !== owner) return
    try {
      const db = await idb()
      db.transaction('rumors', 'readwrite').objectStore('rumors').put({ wraps: [...wrapsSeen], rumors: [...byId.values()] }, owner)
    } catch { /* storage blocked: unwrap again next time */ }
  }, 1000)
}

// ── reading ────────────────────────────────────────────────────────────────
function toMessage(rumor, me) {
  const others = [...new Set((rumor.tags || []).filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]))].filter((p) => p !== rumor.pubkey)
  // one-to-one only: Astral's conversations are with one person
  const peer = rumor.pubkey === me ? others.find((p) => p !== me) : rumor.pubkey
  if (!peer || others.filter((p) => p !== me && p !== peer).length) return null
  return {
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: 14,
    tags: rumor.tags || [],
    content: '',
    text: rumor.content || '',
    peer,
    nip17: true,
  }
}

function add(msg) {
  if (!msg || byId.has(msg.id)) return false
  byId.set(msg.id, msg)
  nip17State.version++
  return true
}

async function unwrap(store, wrap) {
  const me = store.state.keys.pub
  const seal = JSON.parse(await nip44DecryptFrom(store, wrap.pubkey, wrap.content))
  if (seal.kind !== 13 || !verifyEvent(seal)) throw new Error('bad seal')
  const rumor = JSON.parse(await nip44DecryptFrom(store, seal.pubkey, seal.content))
  if (rumor.pubkey !== seal.pubkey) throw new Error('rumor and seal authors differ')
  if (rumor.kind !== 14) return null // file messages (15) and others: not shown
  rumor.id = getEventHash(rumor)
  return toMessage(rumor, me)
}

// one unwrap at a time: a phone signer handles requests in order anyway
let chain = Promise.resolve()

export async function startNip17(store) {
  const me = store.state.keys.pub
  if (!me) return
  if (nip17State.owner === me && sub) return
  stopNip17()
  nip17State.owner = me
  nip17State.failed = 0
  byId = new Map()
  wrapsSeen = new Set()
  const cached = await loadCached(me)
  if (nip17State.owner !== me) return
  cached.wraps.forEach((id) => wrapsSeen.add(id))
  cached.rumors.forEach((m) => byId.set(m.id, m))
  nip17State.version++

  const own = Object.entries(store.state.relays || {}).filter(([u, o]) => /^wss?:\/\//.test(u) && o?.read !== false).map(([u]) => u)
  allowRelayLogin(own)
  const inbox = await inboxRelays(me, own)
  if (nip17State.owner !== me) return
  allowRelayLogin(inbox)
  const relays = [...new Set([...inbox, ...(inbox.length ? [] : own), ...DEFAULT_RELAYS])]
  sub = ndk.subscribe(
    { kinds: [1059], '#p': [me] },
    { closeOnEose: false, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, relaySet: relaySet(relays), exclusiveRelay: true }
  )
  sub.on('event', (e) => {
    const wrap = e.rawEvent ? e.rawEvent() : e
    if (wrapsSeen.has(wrap.id)) return
    wrapsSeen.add(wrap.id)
    chain = chain.then(async () => {
      if (nip17State.owner !== me) return
      try {
        add(await unwrap(store, wrap))
      } catch (err) {
        nip17State.failed++
        console.warn('[nip17] could not unwrap', wrap.id.slice(0, 8), err?.message || err)
      }
      saveSoon(me)
    })
  })
}

export function stopNip17() {
  try { sub?.stop() } catch { /* stopped */ }
  sub = null
}

// Messages with one person, oldest first.
export function nip17With(peer) {
  void nip17State.version
  return [...byId.values()].filter((m) => m.peer === peer).sort((a, b) => a.created_at - b.created_at)
}

// peer → newest message time, for the inbox list.
export function nip17Chats() {
  void nip17State.version
  const latest = new Map()
  for (const m of byId.values()) if (!latest.has(m.peer) || m.created_at > latest.get(m.peer)) latest.set(m.peer, m.created_at)
  return latest
}

export function nip17UnreadFrom(peer, since) {
  return [...byId.values()].filter((m) => m.peer === peer && m.pubkey === peer && m.created_at > since).length
}

// ── sending ────────────────────────────────────────────────────────────────
async function wrapFor(store, rumor, recipient) {
  const seal = await signAsynchronously({
    kind: 13,
    pubkey: store.state.keys.pub,
    created_at: randomPast(),
    tags: [],
    content: await nip44EncryptTo(store, recipient, JSON.stringify(rumor)),
  }, store)
  const ephemeral = generateSecretKey()
  return finalizeEvent({
    kind: 1059,
    created_at: randomPast(),
    tags: [['p', recipient]],
    content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(ephemeral, recipient)),
  }, ephemeral)
}

// Send text to peer as NIP-17 if they have an inbox list. Returns the message
// (shown at once) or null when they don't, so the caller sends kind 4.
export async function sendNip17(store, peer, text, extraTags = []) {
  const me = store.state.keys.pub
  const theirs = await inboxRelays(peer, Object.keys(store.state.relays || {}))
  if (!theirs.length) return null
  const own = Object.entries(store.state.relays || {}).filter(([u, o]) => /^wss?:\/\//.test(u) && o?.write !== false).map(([u]) => u)
  const mine = await inboxRelays(me, own)
  allowRelayLogin([...theirs, ...mine])
  const rumor = { pubkey: me, created_at: nowSec(), kind: 14, tags: [['p', peer], ...extraTags.filter((t) => t[0] !== 'p')], content: text }
  rumor.id = getEventHash(rumor)
  const forThem = await wrapFor(store, rumor, peer)
  const forMe = await wrapFor(store, rumor, me)
  const sent = await publish(forThem, theirs)
  if (!sent) throw new Error('no inbox relay of theirs took the message')
  wrapsSeen.add(forMe.id)
  publish(forMe, mine.length ? mine : [...new Set([...own, ...DEFAULT_RELAYS])]) // your copy, for your other apps
  const msg = toMessage(rumor, me)
  add(msg)
  saveSoon(me)
  return msg
}
