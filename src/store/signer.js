import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import ndk from '../nostr/ndk'

// A key held in this browser (pasted, created, or restored from storage) is
// also NDK's signer, so code that asks ndk.signer works for these accounts too:
// zap requests, the canSign / canEncrypt getters, NDK's own signing.
// Remote sign-ins (Cosign, extension, bunker) keep only the pubkey in the store
// and bind their own signer in the AuthManager; this never replaces or clears
// a signer it didn't set.

let localSigner = null

function sync(keys) {
  if (keys?.priv) {
    if (localSigner?.privateKey === keys.priv && ndk.signer === localSigner) return
    localSigner = new NDKPrivateKeySigner(keys.priv)
    ndk.signer = localSigner
    if (keys.pub) ndk.activeUser = ndk.getUser({ pubkey: keys.pub })
  } else if (localSigner) {
    // The key left this browser: sign-out, or "protect your account" moved it
    // to Cosign (which has already bound its own signer).
    if (ndk.signer === localSigner) ndk.signer = undefined
    localSigner = null
  }
}

export default function (store) {
  sync(store.state.keys) // restored from storage
  store.subscribe(({ type }, state) => {
    if (type === 'setKeys') sync(state.keys)
  })
}
