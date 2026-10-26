// Where the app finds the AuthManager (sign-in with an extension, a phone
// signer or a bunker). The manager itself is big — nostr-tools' NIP-46 client
// and the Cosign pairing code — and a visitor who isn't signed in doesn't need
// it to see the feed, so it isn't part of the first load: boot/auth.js loads it
// at once when a sign-in is stored, otherwise once the page is up, and anything
// that signs someone in can ask for it sooner with loadAuthManager().

let manager = null
let loading = null
const waiting = []

export function getAuthManager() {
  return manager
}

export function loadAuthManager() {
  if (manager) return Promise.resolve(manager)
  if (!loading) {
    loading = Promise.all([import('./authManager'), import('./ndk')]).then(([m, n]) => {
      manager = m.createAuthManager(n.default)
      waiting.splice(0).forEach((fn) => fn(manager))
      return manager
    })
  }
  return loading
}

// Run fn with the manager as soon as there is one.
export function onAuthManager(fn) {
  if (manager) fn(manager)
  else waiting.push(fn)
}
