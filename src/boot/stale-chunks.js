import { boot } from 'quasar/wrappers'

// After a deploy, a page that was already open can ask for a lazy chunk the
// server no longer has (only the current deploy's files are served). Vite
// reports that as vite:preloadError; reload once to pick up the new build
// instead of leaving a broken page.
//
// The reload goes to the page that was being opened: tapping "messages" on a
// stale tab used to reload the feed it was leaving, which looked like the tap
// did nothing.
const KEY = 'astral.staleChunkReload'
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i

export default boot(({ router }) => {
  let heading = null // fullPath of the navigation in progress
  router.beforeEach((to) => { heading = to.fullPath })
  router.afterEach(() => { heading = null })

  const reloadOnce = (path) => {
    let last = 0
    try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* storage blocked */ }
    if (Date.now() - last < 60 * 1000) return false // already tried; let the error show
    try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
    if (path && path !== window.location.pathname + window.location.search + window.location.hash) {
      window.location.assign(router.resolve(path).href)
    } else {
      window.location.reload()
    }
    return true
  }

  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce(heading)) event.preventDefault()
  })

  // a failed route chunk that got past the preload wrapper
  router.onError((error, to) => {
    if (CHUNK_ERROR.test(String(error?.message || error))) reloadOnce(to?.fullPath || heading)
  })
})
