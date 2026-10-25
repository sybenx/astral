import DOMPurify from 'dompurify'
import { Notify } from 'quasar'
import {getEventHash, signEvent} from './ntcompat'
import ndk from '../nostr/ndk'
import { getAuthManager } from '../nostr/authManager'

export function cleanEvent(event) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }
}

export function metadataFromEvent(event) {
  try {
    let metadata = JSON.parse(event.content)
    for (let key of Object.keys(metadata)) metadata[key] = DOMPurify.sanitize(metadata[key])
    metadata.pubkey = event.pubkey
    metadata.created_at = event.created_at
    return metadata
  } catch (_) {
    console.log('metadataFromEvent error', _, event)
    return {}
  }
}

export function isValidEvent(event) {
  if (event.tags.filter(([t, v]) => t === 'e' && (!v || v.includes(' '))).length) return false
  if (event.content === 'this workshop is awesome!') return false
  if (event.content === 'Hello Nostr! :)') return false
  if (event.content.trim() === '') return false
  if (event.seen_on?.length && event.seen_on.includes('wss://rsslay.nostr.net')) return false
  try {
    JSON.parse(event.content)
    return false
  } catch (error) { /* nothing to do */ }
  return true
}

const SIGNER_TIMEOUT_MS = 30_000
const SIGNER_TIMEOUT_MSG = 'Signer timed out — check your extension or sign in again.'
// A phone signer can hold a request for approval, or 10 s for Undo on a
// deletion; Cosign answers within about 70 s, so wait a little longer.
const PHONE_TIMEOUT_MS = 90_000
const PHONE_TIMEOUT_MSG = "your phone didn't answer. check marble or your signer app, then try again."
const PHONE_WAIT_NOTICE_MS = 3_000

function withSignerTimeout(promise, ms = SIGNER_TIMEOUT_MS, message = SIGNER_TIMEOUT_MSG) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ])
}

// Cosign's servers start an error with a stable code. Say what it means.
function phoneSignerError(err) {
  const msg = err?.message || String(err)
  if (msg.startsWith('revoked:')) {
    getAuthManager()?.handleRevoked()
    return new Error('This site was removed on your phone. Sign in again to post.')
  }
  if (msg.startsWith('refused:')) return new Error(`Your phone refused this: ${msg.slice(8).trim()}`)
  if (msg.startsWith('not-allowed:')) return new Error(`Not allowed: ${msg.slice(12).trim()}`)
  if (msg.startsWith('not-connected:')) return new Error('This site is no longer connected to your phone. Sign in again.')
  return err instanceof Error ? err : new Error(msg)
}

// Sign through a phone (Cosign or another NIP-46 app). If it takes more than a
// moment, say so: the request may be waiting for approval on the phone.
async function signWithPhone(event) {
  let notice = null
  const timer = setTimeout(() => {
    notice = Notify.create({ message: 'waiting for your phone…', spinner: true, timeout: 0, color: 'grey-9' })
  }, PHONE_WAIT_NOTICE_MS)
  try {
    return await withSignerTimeout(ndk.signer.sign(event), PHONE_TIMEOUT_MS, PHONE_TIMEOUT_MSG)
  } catch (err) {
    throw phoneSignerError(err)
  } finally {
    clearTimeout(timer)
    if (notice) notice()
  }
}

function isPhoneSigner() {
  return !!getAuthManager()?.bunkerSigner
}

export async function signAsynchronously(event, store) {
  event.id = getEventHash(event)

  // Local private key — sign directly.
  if (store.state.keys.priv) {
    event.sig = signEvent(event, store.state.keys.priv)
    return event
  }

  // Remote/extension signer established by the AuthManager (NIP-07 or NIP-46).
  // NDK routes to whichever signer is active; this covers both uniformly.
  if (ndk.signer) {
    event.sig = isPhoneSigner() ? await signWithPhone(event) : await withSignerTimeout(ndk.signer.sign(event))
    return event
  }

  // Fallback: a raw NIP-07 extension that was never wired through the signer.
  if (window.nostr) {
    const result = await withSignerTimeout(window.nostr.signEvent(event))
    if (typeof result === 'string') {
      event.sig = result
    } else if (result && typeof result === 'object') {
      // Extension returns the full signed event — use it wholesale so the
      // id/sig pair is exactly what the extension computed (avoids mismatch
      // if the extension's serialization differs from our getEventHash).
      Object.assign(event, result)
    } else {
      throw new Error('Failed to sign with Nostr extension.')
    }
  }
  return event
  // } else {
  //   return new Promise((resolve, reject) => {
  //     Dialog.create({
  //       class: 'px-6 py-1 overflow-hidden',
  //       title: 'Sign this event manually',
  //       message: `<pre class="font-mono">${JSON.stringify(
  //         event,
  //         null,
  //         2
  //       )}</pre>`,
  //       html: true,
  //       prompt: {
  //         model: '',
  //         type: 'text',
  //         isValid: val => !!val.toLowerCase().match(/^[a-z0-9]{128}$/),
  //         attrs: {autocomplete: 'off'},
  //         label: 'Paste the signature here (as hex)'
  //       }
  //     })
  //       .onOk(resolve)
  //       .onCancel(() => reject('Canceled.'))
  //       .onDismiss(() => reject('Canceled.'))
  //   })
  // }
}
