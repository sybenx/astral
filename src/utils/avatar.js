// Avatars: a generated identicon in the theme's colours whenever a profile has
// no picture or its picture won't load. Hosts that keep failing (and never
// loaded anything) are skipped, so a dead image host isn't asked again for
// every post on the page.
import Identicon from 'identicon.js'
import { reactive } from 'vue'

const identicons = new Map() // `${pubkey}|${accent}|${background}` → data URI
const hostFailures = new Map() // host → failed loads
const hostsThatWork = new Set()
const failedUrls = new Set() // a picture that failed once isn't asked for again
const DEAD_AFTER = 2

function rgba(hex, alpha = 255) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

export function identiconFor(pubkey, { accent = '#888888', background = '#1f1f1f' } = {}) {
  const key = `${pubkey}|${accent}|${background}`
  let uri = identicons.get(key)
  if (!uri) {
    try {
      const svg = new Identicon(pubkey, {
        size: 64,
        margin: 0.12,
        format: 'svg',
        foreground: rgba(accent) || [136, 136, 136, 255],
        background: rgba(background) || [31, 31, 31, 255],
      }).toString()
      uri = 'data:image/svg+xml;base64,' + svg
    } catch {
      uri = ''
    }
    identicons.set(key, uri)
  }
  return uri
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function isDeadHost(url) {
  if (failedUrls.has(url)) return true
  const host = hostOf(url)
  return !!host && !hostsThatWork.has(host) && (hostFailures.get(host) || 0) >= DEAD_AFTER
}

export function markImageFailed(url) {
  if (failedUrls.has(url)) return // many avatars of one person fail together; count it once
  failedUrls.add(url)
  const host = hostOf(url)
  if (host) hostFailures.set(host, (hostFailures.get(host) || 0) + 1)
}

export function markImageLoaded(url) {
  const host = hostOf(url)
  if (host) hostsThatWork.add(host)
}

// One request per picture, however many avatars show it: the first avatar
// starts a probe, the rest watch its result here ('loading' | 'ok' | 'failed').
export const pictureState = reactive({})
const LOAD_TIMEOUT = 8000 // ms before a picture that hasn't loaded counts as failed

export function loadPicture(url) {
  if (!url || pictureState[url]) return
  if (isDeadHost(url)) {
    pictureState[url] = 'failed'
    return
  }
  pictureState[url] = 'loading'
  const img = new Image()
  const settle = (ok) => {
    if (pictureState[url] !== 'loading') return
    clearTimeout(timer)
    img.onload = img.onerror = null
    pictureState[url] = ok ? 'ok' : 'failed'
    if (ok) markImageLoaded(url)
    else markImageFailed(url)
  }
  const timer = setTimeout(() => settle(false), LOAD_TIMEOUT) // a host that never answers
  img.onload = () => settle(true)
  img.onerror = () => settle(false)
  img.decoding = 'async'
  img.src = url
}
