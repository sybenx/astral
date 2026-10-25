// Expiry for NDK's IndexedDB cache (astral-ndk-cache). ndk-cache-dexie never
// deletes anything, so a daily browser keeps every note it ever scrolled past.
// Once a day, ~30s after start and when the browser is idle:
//   - notes older than 14 days go (3 days once the cache passes 50k events),
//     except your own and replaceable lists (profiles, follows, relay, mute
//     and bookmark lists: kinds 0, 3, 10000–19999, 30000–39999);
//   - their tag index rows go with them;
//   - profiles not refreshed for 30 days, NIP-05 and LNURL lookups after 7.
// Nothing here is the only copy: relays have it all, and it's fetched again
// when needed.

import { db } from '@nostr-dev-kit/ndk-cache-dexie'

const KEY = 'astral.cachePrunedAt'
const DAY = 24 * 60 * 60
const EVENT_DAYS = 14
const CROWDED = 50000
const CROWDED_EVENT_DAYS = 3
const PROFILE_DAYS = 30
const LOOKUP_DAYS = 7
const CHUNK = 500

const keepKind = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000)

async function bulkDelete(table, keys) {
  for (let i = 0; i < keys.length; i += CHUNK) await table.bulkDelete(keys.slice(i, i + CHUNK))
}

export async function pruneCache(ownPubkey = null) {
  if (!db) return null
  const now = Math.floor(Date.now() / 1000)
  const total = await db.events.count()
  const cutoff = now - (total > CROWDED ? CROWDED_EVENT_DAYS : EVENT_DAYS) * DAY
  const oldIds = await db.events
    .filter((e) => e.createdAt < cutoff && !keepKind(e.kind) && e.pubkey !== ownPubkey)
    .primaryKeys()
  await bulkDelete(db.events, oldIds)

  const gone = new Set(oldIds)
  const tagKeys = gone.size ? await db.eventTags.filter((t) => gone.has(t.eventId)).primaryKeys() : []
  await bulkDelete(db.eventTags, tagKeys)

  const profileKeys = await db.profiles
    .filter((p) => (p.cachedAt || 0) < now - PROFILE_DAYS * DAY && p.pubkey !== ownPubkey)
    .primaryKeys()
  await bulkDelete(db.profiles, profileKeys)

  const lookupCutoff = Date.now() - LOOKUP_DAYS * DAY * 1000 // these two store milliseconds
  await bulkDelete(db.nip05, await db.nip05.filter((n) => (n.fetchedAt || 0) < lookupCutoff).primaryKeys())
  await bulkDelete(db.lnurl, await db.lnurl.filter((n) => (n.fetchedAt || 0) < lookupCutoff).primaryKeys())

  return { events: oldIds.length, of: total, tags: tagKeys.length, profiles: profileKeys.length }
}

// Run pruneCache at most once a day, after start-up has settled.
export function schedulePrune(getOwnPubkey) {
  let last = 0
  try { last = Number(localStorage.getItem(KEY)) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < DAY * 1000) return
  // the timeout: a busy or background tab may never report idle time
  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 10 * 1000 })
    : (fn) => setTimeout(fn, 1000)
  setTimeout(() => idle(async () => {
    try {
      await pruneCache(getOwnPubkey())
      localStorage.setItem(KEY, String(Date.now()))
    } catch (err) {
      console.warn('[cache] prune failed', err)
    }
  }), 30 * 1000)
}
