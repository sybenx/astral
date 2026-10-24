import { boot } from 'quasar/wrappers'

// After a deploy, a page that was already open can ask for a lazy chunk the
// server no longer has. Vite reports that as vite:preloadError; reload once
// to pick up the new build instead of leaving a broken page.
const KEY = 'astral.staleChunkReload'

export default boot(() => {
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* storage blocked */ }
    if (Date.now() - last < 60 * 1000) return // already tried; let the error show
    try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
    event.preventDefault()
    window.location.reload()
  })
})
