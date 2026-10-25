// What the signed-in user's NIP-51 mute list (kind 10000) hides: people (p),
// hashtags (t), words (word) and threads (e), public and private parts alike.
// Kept outside Pinia so the feed engine and plain modules can check it; the
// mutes store (src/stores/mutes.js) fills it in. `version` changes on every
// update, for anything that has to re-check what it already shows.

import { reactive } from 'vue'

export const muteState = reactive({ version: 0 })

let pubkeys = new Set()
let hashtags = new Set()
let words = []
let threads = new Set()

export function setMutes(tags) {
  pubkeys = new Set()
  hashtags = new Set()
  words = []
  threads = new Set()
  for (const [name, value] of tags || []) {
    if (!value) continue
    if (name === 'p') pubkeys.add(value)
    else if (name === 't') hashtags.add(value.toLowerCase())
    else if (name === 'word') words.push(value.toLowerCase())
    else if (name === 'e') threads.add(value)
  }
  muteState.version++
}

export function isMutedPubkey(pubkey) {
  return pubkeys.has(pubkey)
}

export function isMutedEvent(e) {
  if (!e) return false
  if (pubkeys.has(e.pubkey) || threads.has(e.id)) return true
  for (const [name, value] of e.tags || []) {
    if (name === 't' && value && hashtags.has(value.toLowerCase())) return true
    if (name === 'e' && threads.has(value)) return true
  }
  if (words.length && e.content) {
    const text = e.content.toLowerCase()
    if (words.some((w) => text.includes(w))) return true
  }
  return false
}
