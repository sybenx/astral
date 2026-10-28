// Astral against the shared content fixtures (marble-content-fixtures: rules and real events shared with Marble):
//   node scripts/content-fixtures.mjs [site=http://localhost:8080] [only=name-part] [repo=~/marble-content-fixtures]
//   (or: npm run content-fixtures)
// Needs the dev server (npm run dev) and the fixtures repo, whose Playwright it borrows. Each fixture's post opens in
// Astral's thread view; the page's WebSocket is a small in-page relay that answers from the fixture and what it points
// to, so nothing reaches the network. The main post is read back as tokens and compared with the repo's compare.mjs.
//
// Results at marble-content-fixtures 0253b1f: 9/25 pass, 26 n/a (no article page). The rest are Astral's own design:
// a short link and a card for every reference, Markdown in kind 1, YouTube as a player, the sanitizer, no article card,
// lowercase wording; or NIP-30 emoji in posts and NIP-36 content warnings, which Astral doesn't do.

import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { nip19 } from 'nostr-tools'

const arg = (k, d) => (process.argv.find((a) => a.startsWith(k + '=')) || '').slice(k.length + 1) || d
const SITE = arg('site', 'http://localhost:8080')
const ONLY = arg('only', '')
const REPO = arg('repo', join(homedir(), 'marble-content-fixtures'))
const { chromium } = createRequire(join(REPO, 'package.json'))('playwright')
const { compare } = await import(join(REPO, 'compare.mjs'))
const DIR = join(REPO, 'fixtures')
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json') && f.includes(ONLY)).sort()
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(DIR, f))) }))

// in the page: a relay that answers every socket from these events (NIP-01 REQ / EVENT / CLOSE)
function fakeRelay(events) {
  const match = (f, e) => {
    if (f.ids && !f.ids.includes(e.id)) return false
    if (f.kinds && !f.kinds.includes(e.kind)) return false
    if (f.authors && !f.authors.includes(e.pubkey)) return false
    if (f.since && e.created_at < f.since) return false
    if (f.until && e.created_at > f.until) return false
    for (const [k, v] of Object.entries(f)) {
      if (k[0] === '#' && Array.isArray(v) && !(e.tags || []).some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false
    }
    return true
  }
  class Relay extends EventTarget {
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      setTimeout(() => { this.readyState = 1; this.fire('open', new Event('open')) }, 5)
    }
    fire(type, ev) { this.dispatchEvent(ev); this['on' + type]?.(ev) }
    reply(m) { setTimeout(() => this.readyState === 1 && this.fire('message', new MessageEvent('message', { data: JSON.stringify(m) })), 1) }
    send(raw) {
      const m = JSON.parse(raw)
      if (m[0] === 'REQ') {
        const [, id, ...fs] = m
        const limit = Math.max(...fs.map((f) => f.limit || 500))
        events.filter((e) => fs.some((f) => match(f, e))).sort((a, b) => b.created_at - a.created_at).slice(0, limit)
          .forEach((e) => this.reply(['EVENT', id, e]))
        this.reply(['EOSE', id])
      } else if (m[0] === 'EVENT') this.reply(['OK', m[1].id, true, ''])
    }
    close() { this.readyState = 3; this.fire('close', new CloseEvent('close')) }
  }
  Object.assign(Relay, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  window.WebSocket = Relay
  sessionStorage.setItem('astral.lookingAround', '1')
}

// Astral's thread view, read as tokens (content-rules.md, "Fixtures")
function read() {
  const main = document.querySelector('.q-page .q-item[style*="border: 2px solid"]')
  const got = { inline: [], cards: [], media: [], warning: null, visible: '' }
  const body = main && [...main.querySelectorAll('.dynamic-content, .unknown-kind')].find((el) => !el.closest('.reposts'))
  if (!body) return got
  const eventOf = (el) => { for (let c = el.__vueParentComponent; c; c = c.parent) if (c.props?.event) return c.props.event; return null }
  const text = (s) => { s = s.replace(/\s+/g, ' '); if (s.trim()) got.inline.push({ text: s }) }
  const bech = (href) => href.replace(/^https:\/\/njump\.me\//, '').replace(/^\//, '')
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { text(n.textContent); continue }
      if (n.nodeType !== 1) continue
      const href = n.getAttribute('href') || ''
      if (n.matches('br')) text(' \n ')
      else if (n.matches('a') && /^\/(npub1|nprofile1)/.test(href)) got.inline.push({ mention: bech(href) })
      else if (n.matches('a') && href.startsWith('/hashtag/')) got.inline.push({ hashtag: n.textContent.trim().replace(/^#/, '') })
      else if (n.matches('a') && /^(\/(note1|nevent1)|https:\/\/njump\.me\/(naddr1|nevent1|note1))/.test(href)) got.inline.push({ shortlink: bech(href) })
      else if (n.matches('a') && /^https?:/.test(href)) got.inline.push({ link: href })
      else if (n.matches('img')) got.media.push({ image: n.getAttribute('src') })
      else if (n.matches('video')) got.media.push({ video: n.getAttribute('src'), ...(n.getAttribute('poster') ? { poster: n.getAttribute('poster') } : {}) })
      else walk(n)
    }
  }
  walk(body)
  for (const card of main.querySelectorAll('.reposts > div > *')) {
    const e = eventOf(card)
    got.cards.push({
      card: card.querySelector('.unknown-kind') ? 'other' : e?.kind === 1 ? 'note' : `kind ${e?.kind}`,
      ref: e ? e.address || e.id : '?',
      text: card.textContent.replace(/\s+/g, ' '),
    })
  }
  const copy = body.cloneNode(true)
  copy.querySelectorAll("a[href^='http'], a[href^='/']").forEach((a) => a.remove())
  got.visible = copy.textContent
  return got
}

const browser = await chromium.launch()
let failed = 0
let skipped = 0
for (const f of fixtures) {
  const e = f.event
  if (e.kind === 30023) { console.log(`n/a  ${f.file}  (Astral has no page for an article)`); skipped++; continue }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(fakeRelay, [f.event, ...f.related])
  const page = await context.newPage()
  await page.goto(`${SITE}/${nip19.neventEncode({ id: e.id, author: e.pubkey })}`)
  await page.waitForSelector('.q-page .q-item[style*="border: 2px solid"] .post-padding', { timeout: 15000 }).catch(() => {})
  // the cards fill in once what they point to arrives
  await page.waitForFunction((n) => document.querySelectorAll('.q-page .q-item[style*="border: 2px solid"] .reposts > div > *').length >= n,
    (f.expect.cards || []).length, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)
  const got = await page.evaluate(read)
  for (const t of got.inline) {
    if (!t.mention) continue
    try { const d = nip19.decode(t.mention); t.mention = d.type === 'npub' ? d.data : d.data.pubkey } catch { /* left as read */ }
  }
  const problems = compare(f.expect, got)
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${f.file}${problems.length ? '\n       ' + problems.join('\n       ') : ''}`)
  if (problems.length) failed++
  await context.close()
}
await browser.close()
console.log(`${fixtures.length - failed - skipped}/${fixtures.length - skipped} pass (${skipped} n/a)`)
process.exit(failed ? 1 : 0)
