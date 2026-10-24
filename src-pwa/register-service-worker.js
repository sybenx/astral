import { register } from 'register-service-worker'

// Astral installs quietly: no install banner, no "new version" prompt.
//
// Updates: a new service worker installs in the background and waits (the
// build turns skipWaiting off). Swapping it in under an open page could leave
// that page asking for lazy chunks the new deploy no longer has, so the swap
// only happens while the page is hidden, followed by a reload nobody sees.

let waiting = null
let swapping = false

register(process.env.SERVICE_WORKER_FILE, {
  updated(registration) {
    waiting = registration.waiting
    if (document.hidden) swap()
  },
  error(err) {
    console.warn('[sw] registration failed', err)
  }
})

function swap() {
  if (!waiting || swapping) return
  swapping = true
  waiting.postMessage({ type: 'SKIP_WAITING' }) // handled by the Workbox-generated sw.js
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) swap()
})

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  // Only after our own swap: the first install also changes the controller.
  if (swapping) window.location.reload()
})

// Chrome on Android shows an install mini-bar on its own; keep installing to
// the browser menu instead.
window.addEventListener('beforeinstallprompt', (e) => e.preventDefault())
