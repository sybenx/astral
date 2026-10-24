// "Sign in" with a phone: Cosign's QRST sign-in, with a nostrconnect:// fallback
// in the same code for any other NIP-46 signer app. The protocol code is vendored
// unchanged from cosign v0.7.0 (src/vendor/cosign); this file is Astral's glue.
//
// Whichever answers first signs in. A Cosign sign-in gives a SignerClient that
// talks to the user's Cosign servers; the fallback gives a nostr-tools
// BunkerSigner. Both expose getPublicKey / signEvent / nip04* / nip44* / close.

import { BunkerSigner } from 'nostr-tools/nip46'
import { pair, restore, forget } from '../vendor/cosign/src/pair.ts'
import { SignerClient } from '../vendor/cosign/src/client.ts'

// The bounce page a phone's camera opens; Cosign owns its App Links.
const BASE_URL = 'https://cosign.aaro.cc/'
// pair.ts keeps the fallback's signer here as { sk, bp }. We rewrite bp when the
// signer moves us to other relays (switch_relays), so a reload uses those.
const NC_KEY = 'cosign.nostrconnect'

const storage = typeof window !== 'undefined' ? window.localStorage : undefined

export function isCosign(signer) {
  return signer instanceof SignerClient
}

// Show a code and wait. `ui` is pair()'s: code(uri), confirm(text, yes, no), status(text).
export function startSignIn(ui) {
  return pair({
    origin: window.location.origin,
    baseUrl: BASE_URL,
    storage,
    nostrconnect: { name: 'astral', url: window.location.origin },
    ui
  })
}

// The signer from a previous visit, if any. The phone may have removed it since;
// the first call to it says so.
export function restoreSignIn() {
  return storage ? restore(storage) : undefined
}

// Ask a nostrconnect signer for its preferred relays and remember them.
// Cosign's servers answer with their group relays; signers that don't support
// switch_relays answer with nothing and we keep what we have.
export async function settleRelays(signer) {
  if (!(signer instanceof BunkerSigner) || !storage) return
  try {
    await Promise.race([signer.switchRelays(), new Promise((resolve) => setTimeout(resolve, 5000))])
  } catch (e) {
    console.warn('[sign-in] switch_relays:', e?.message || e)
  }
  try {
    const saved = JSON.parse(storage.getItem(NC_KEY) || 'null')
    if (saved && JSON.stringify(saved.bp.relays) !== JSON.stringify(signer.bp.relays)) {
      storage.setItem(NC_KEY, JSON.stringify({ ...saved, bp: signer.bp }))
    }
  } catch { /* nothing saved to update */ }
}

// Sign out for good: Cosign drops this site from the phone's list. A plain
// nostrconnect signer just closes.
export async function signOut(signer) {
  try {
    if (isCosign(signer)) await signer.logout()
    else if (signer) await signer.close()
  } catch (e) {
    console.warn('[sign-in] logout:', e?.message || e)
  } finally {
    if (storage) forget(storage)
  }
}

export function forgetSignIn() {
  if (storage) forget(storage)
}
