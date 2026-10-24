// astral.syb.lol Worker. Static assets (the PWA) are served by Cloudflare
// directly; this script only runs for /api/* (see run_worker_first in
// wrangler.jsonc).
//
// GET /api/og?url=<page>  →  { title, description, image, siteName } for a
// link preview card. Replaces microlink.io (25 requests a day per viewer, and
// it saw every link people scrolled past). Results are cached at the edge, so
// a link is fetched once however many people see it.

const MAX_HTML = 512 * 1024 // stop reading after this; the <head> is near the top
const TIMEOUT_MS = 5000
const OK_TTL = 24 * 60 * 60
const MISS_TTL = 60 * 60

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api/og') return linkPreview(request, url, ctx)
    return new Response('not found', { status: 404 })
  }
}

async function linkPreview(request, url, ctx) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405, 0)
  // Soft guard against use as a public proxy: only our own pages. Browsers
  // mark same-origin fetches with Sec-Fetch-Site; the Referer is a fallback.
  if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403, 0)

  const target = safeTarget(url.searchParams.get('url'))
  if (!target) return json({ error: 'bad url' }, 400, MISS_TTL)

  const cache = caches.default
  const key = new Request(`https://astral.syb.lol/api/og?url=${encodeURIComponent(target)}`)
  const hit = await cache.match(key)
  if (hit) return hit

  let card = null
  try {
    card = await readCard(target)
  } catch {
    /* timeout, refused, not HTML: no card */
  }
  const res = json(card || {}, 200, card ? OK_TTL : MISS_TTL)
  ctx.waitUntil(cache.put(key, res.clone()))
  return res
}

function sameOrigin(request, url) {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true
  try {
    return new URL(request.headers.get('referer')).host === url.host
  } catch {
    return false
  }
}

// http(s) only, no credentials, no IP literals or local names.
function safeTarget(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return null
  if (/\.(local|internal|localhost|lan|home)$/.test(host) || !host.includes('.')) return null
  u.hash = ''
  return u.toString()
}

async function readCard(target) {
  const res = await fetch(target, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; AstralLinkPreview/1.0; +https://astral.syb.lol)',
      accept: 'text/html,application/xhtml+xml'
    }
  })
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null

  const meta = {}
  let title = ''
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase()
        const content = el.getAttribute('content')
        if (name && content && !(name in meta)) meta[name] = content
      }
    })
    .on('title', {
      text(chunk) {
        if (title.length < 300) title += chunk.text
      }
    })

  // Only the first MAX_HTML bytes go through the rewriter.
  const limited = res.body.pipeThrough(limitBytes(MAX_HTML))
  await rewriter.transform(new Response(limited, { headers: res.headers })).arrayBuffer()

  const pick = (...names) => names.map((n) => meta[n]).find((v) => v && v.trim())
  const card = {
    title: clean(pick('og:title', 'twitter:title') || title, 200),
    description: clean(pick('og:description', 'twitter:description', 'description'), 400),
    image: absolute(decodeEntities(pick('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') || ''), res.url),
    siteName: clean(pick('og:site_name'), 100)
  }
  return card.title || card.description || card.image ? card : null
}

function limitBytes(max) {
  let seen = 0
  return new TransformStream({
    transform(chunk, controller) {
      if (seen >= max) return controller.terminate()
      seen += chunk.byteLength
      controller.enqueue(chunk)
    }
  })
}

// HTMLRewriter hands attribute values over with their entities still encoded.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
  })
}

function clean(text, max) {
  if (!text) return null
  const t = decodeEntities(text).replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

function absolute(src, base) {
  if (!src) return null
  try {
    const u = new URL(src.trim(), base)
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null
  } catch {
    return null
  }
}

function json(body, status, ttl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store'
    }
  })
}
