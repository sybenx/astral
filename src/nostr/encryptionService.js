// Signer-agnostic NIP-44 self-encryption for relay-stored backups.
//
// Encrypts to the user's own pubkey so only they can read it. Works across
// every Astral signer:
//   - local key (Vuex keys.priv) → nostr-tools nip44 directly
//   - NIP-07 extension → window.nostr.nip44
//   - NIP-46 bunker → nip44_*_via RPC (src/nostr/nip46Rpc.js)
//
// Distilled from zapcooking's encryptionService.ts (we only need self/NIP-44).

import * as nip44 from 'nostr-tools/nip44'
import { hexToBytes } from '@noble/hashes/utils.js'
import ndk from './ndk'
import { nip44EncryptViaNip46, nip44DecryptViaNip46 } from './nip46Rpc'

function signerIsNip46() {
  const name = ndk.signer?.constructor?.name || ''
  // Matches both old NDKNip46Signer and new Nip46NdkSigner
  return name.includes('Nip46')
}

function hasNip07Nip44() {
  return typeof window !== 'undefined' && !!window.nostr?.nip44?.encrypt
}

// Whether the active signer can produce a backup that's later decryptable.
// All three Astral signer types encrypt under the user's real key, so all are
// allowed (NIP-46 goes through nip44_encrypt RPC to the bunker's user key).
export function canBackup(store) {
  if (!store?.state?.keys?.pub) return false
  if (store.state.keys.priv) return true
  if (hasNip07Nip44()) return true
  if (ndk.signer) return true
  return false
}

export async function encryptSelf(store, plaintext) {
  const pub = store.state.keys.pub
  if (!pub) throw new Error('not signed in')

  if (store.state.keys.priv) {
    const ck = nip44.v2.utils.getConversationKey(hexToBytes(store.state.keys.priv), pub)
    return nip44.v2.encrypt(plaintext, ck)
  }
  if (hasNip07Nip44()) {
    return window.nostr.nip44.encrypt(pub, plaintext)
  }
  if (signerIsNip46()) {
    return nip44EncryptViaNip46(ndk.signer, pub, plaintext)
  }
  throw new Error('no NIP-44 encryption available with the current signer')
}

export async function decryptSelf(store, ciphertext) {
  const pub = store.state.keys.pub
  if (!pub) throw new Error('not signed in')

  if (store.state.keys.priv) {
    const ck = nip44.v2.utils.getConversationKey(hexToBytes(store.state.keys.priv), pub)
    return nip44.v2.decrypt(ciphertext, ck)
  }
  if (typeof window !== 'undefined' && window.nostr?.nip44?.decrypt) {
    return window.nostr.nip44.decrypt(pub, ciphertext)
  }
  if (signerIsNip46()) {
    return nip44DecryptViaNip46(ndk.signer, pub, ciphertext)
  }
  throw new Error('no NIP-44 decryption available with the current signer')
}

// NIP-44 with another key (NIP-17 seals and gift wraps), for the same three
// kinds of sign-in. peer is a hex pubkey.
export async function nip44EncryptTo(store, peer, plaintext) {
  if (store.state.keys.priv) {
    const ck = nip44.v2.utils.getConversationKey(hexToBytes(store.state.keys.priv), peer)
    return nip44.v2.encrypt(plaintext, ck)
  }
  if (hasNip07Nip44()) return window.nostr.nip44.encrypt(peer, plaintext)
  if (signerIsNip46()) return nip44EncryptViaNip46(ndk.signer, peer, plaintext)
  if (ndk.signer?.encrypt) return ndk.signer.encrypt(ndk.getUser({ pubkey: peer }), plaintext, 'nip44')
  throw new Error('this sign-in can’t encrypt (it has your public key only)')
}

export async function nip44DecryptFrom(store, peer, ciphertext) {
  if (store.state.keys.priv) {
    const ck = nip44.v2.utils.getConversationKey(hexToBytes(store.state.keys.priv), peer)
    return nip44.v2.decrypt(ciphertext, ck)
  }
  if (typeof window !== 'undefined' && window.nostr?.nip44?.decrypt) return window.nostr.nip44.decrypt(peer, ciphertext)
  if (signerIsNip46()) return nip44DecryptViaNip46(ndk.signer, peer, ciphertext)
  if (ndk.signer?.decrypt) return ndk.signer.decrypt(ndk.getUser({ pubkey: peer }), ciphertext, 'nip44')
  throw new Error('this sign-in can’t decrypt (it has your public key only)')
}
