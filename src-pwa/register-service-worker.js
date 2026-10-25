import { register } from 'register-service-worker'

// Astral installs quietly: no install banner, no "new version" prompt.
//
// Updates: a new service worker installs in the background and waits (the
// build turns skipWaiting off). Swapping it in under a page someone is using
// could leave that page asking for lazy chunks the new deploy no longer has,
// so the swap happens only when nobody is in the middle of anything:
//   - while the page is hidden, followed by a reload nobody sees;
//   - right after a load, before any click, key or scroll (the reload that
//     follows is all but invisible). Without this an ordinary reload kept
//     showing the old build: the old worker serves the precached index.html;
//   - when the page is left or reloaded, so the next load gets the new one.

let waiting = null
let swapping = false
let touched = false
const FRESH_MS = 10 * 1000 // "just loaded"
const loadedAt = Date.now()

register(process.env.SERVICE_WORKER_FILE, {
  updated(registration) {
    waiting = registration.waiting
    if (document.hidden || (!touched && Date.now() - loadedAt < FRESH_MS)) swap()
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

for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, () => { touched = true }, { once: true, passive: true, capture: true })
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) swap()
})

// leaving or reloading: activate it now, no reload needed (the page is going anyway)
window.addEventListener('pagehide', () => {
  if (!waiting || swapping) return
  waiting.postMessage({ type: 'SKIP_WAITING' })
})

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  // Only after our own swap: the first install also changes the controller.
  if (swapping) window.location.reload()
})

// Chrome on Android shows an install mini-bar on its own; keep installing to
// the browser menu instead.
window.addEventListener('beforeinstallprompt', (e) => e.preventDefault())
