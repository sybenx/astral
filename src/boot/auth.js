import { boot } from 'quasar/wrappers'
import { loadAuthManager } from '../nostr/auth'

// The AuthManager restores the active NDK signer on reload for NIP-07 and
// NIP-46 sessions (its constructor runs initializeFromStorage()). Keys held in
// this browser get their NDK signer from the store (src/store/signer.js).
// With a sign-in stored it loads at once; otherwise after the page is up, off
// the first load (see src/nostr/auth.js).
export default boot(() => {
  let stored = false
  try {
    stored = !!(localStorage.getItem('astral_authMethod') || localStorage.getItem('astral_loggedInPublicKey'))
  } catch { /* storage blocked */ }
  if (stored) {
    loadAuthManager()
    return
  }
  // a little after load, so it doesn't compete with the feed's own chunks
  const later = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(() => loadAuthManager(), { timeout: 3000 }), 2500)
  if (document.readyState === 'complete') later()
  else window.addEventListener('load', later, { once: true })
})
