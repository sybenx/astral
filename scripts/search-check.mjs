// Standing check for profile search ranking, against the live relays:
//   node scripts/search-check.mjs        (or: npm run search-check)
// Runs the same steps as src/nostr/profileSearch.js (Ditto + syb.lol, Primal's
// order and follower counts, NIP-05 checks) through src/nostr/searchRank.js,
// prints the top 3 per query with timings, and exits 1 if a case misses.

import { rankProfiles, verifyNip05, parseProfile, isBridged } from '../src/nostr/searchRank.js'

const CASES = [
  { query: 'jack', top: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2' }, // Jack Dorsey
  { query: 'alex gleason', top: '0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd' }, // Soapbox / Ditto
]
const SEARCH_RELAYS = ['wss://relay.ditto.pub', 'wss://syb.lol']
const PRIMAL = 'wss://cache2.primal.net/v1'

function req(url, filter, timeout = 2500) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const events = []
    let done = false
    let ws
    const finish = () => {
      if (done) return
      done = true
      try { ws.close() } catch { /* ignore */ }
      resolve({ events, ms: Date.now() - t0 })
    }
    try { ws = new WebSocket(url) } catch { return finish() }
    setTimeout(finish, timeout)
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 's', filter]))
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m[0] === 'EVENT') events.push(m[2])
      else if (['EOSE', 'NOTICE', 'CLOSED'].includes(m[0])) finish()
    }
    ws.onerror = finish
  })
}

const label = (p) => `${p.display_name || p.name || '?'}${p.nip05 ? ` <${p.nip05}>` : ''} ${p.pubkey.slice(0, 8)}`

let failed = 0
for (const { query, top } of CASES) {
  const t0 = Date.now()
  const [ditto, syb, primal] = await Promise.all([
    ...SEARCH_RELAYS.map((url) => req(url, { kinds: [0], search: query, limit: 20 })),
    req(PRIMAL, { cache: ['user_search', { query, limit: 10 }] }),
  ])
  const profiles = new Map()
  const primalRank = new Map()
  primal.events.filter((e) => e.kind === 0).forEach((e, i) => primalRank.set(e.pubkey, i))
  for (const e of [...ditto.events, ...syb.events, ...primal.events.filter((e) => e.kind === 0)]) {
    const p = parseProfile(e)
    if (!p || isBridged(p)) continue
    if (!profiles.has(p.pubkey) || profiles.get(p.pubkey).created_at < p.created_at) profiles.set(p.pubkey, p)
  }
  const all = [...profiles.values()]
  const withNip05 = rankProfiles(all, query, { primalRank }).filter((p) => p.nip05).slice(0, 20)
  const followers = new Map()
  const verified = new Map()
  const [infos] = await Promise.all([
    req(PRIMAL, { cache: ['user_infos', { pubkeys: all.map((p) => p.pubkey).slice(0, 100) }] }),
    ...withNip05.map((p) => verifyNip05(p.nip05, p.pubkey).then((ok) => verified.set(p.pubkey, ok))),
  ])
  for (const e of infos.events) {
    if (e.kind === 10000133) for (const [pk, n] of Object.entries(JSON.parse(e.content))) followers.set(pk, n)
  }
  const ranked = rankProfiles([...profiles.values()], query, { primalRank, followers, verified })
  const ok = ranked[0]?.pubkey === top
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} "${query}"  ditto ${ditto.ms}ms, syb.lol ${syb.ms}ms, primal ${primal.ms}ms, ranked in ${Date.now() - t0}ms`)
  ranked.slice(0, 3).forEach((p, i) =>
    console.log(`     ${i + 1}. ${label(p)}  ${followers.get(p.pubkey) ?? '?'} followers${verified.get(p.pubkey) ? ', nip-05 ok' : ''}`)
  )
}
process.exit(failed ? 1 : 0)
