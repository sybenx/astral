// When to suggest protecting an account whose key lives only in this browser
// (made with "create an account", or a pasted private key).
//
// Not on the first visit: someone who just signed up should get to look around.
// From the second visit or the third note, show it; "later" snoozes it for a few
// days and never turns it off for good, because losing this browser loses the account.

const CREATED_AT = 'astral_accountCreatedAt'
const VISITS = 'astral_localKeyVisits'
const POSTS = 'astral_localKeyPosts'
const SNOOZED_UNTIL = 'astral_protectSnoozedUntil'
const VISIT_COUNTED = 'astral_localKeyVisitCounted' // sessionStorage: once per visit

const VISITS_BEFORE_NUDGE = 2
const POSTS_BEFORE_NUDGE = 3
const SNOOZE_DAYS = 3

function read(key) {
  try { return Number(localStorage.getItem(key)) || 0 } catch { return 0 }
}

function write(key, value) {
  try { localStorage.setItem(key, String(value)) } catch { /* storage unavailable */ }
}

export function markAccountCreated() {
  write(CREATED_AT, Date.now())
  write(VISITS, 1)
  try { sessionStorage.setItem(VISIT_COUNTED, '1') } catch { /* storage unavailable */ }
}

export function countVisit() {
  try {
    if (sessionStorage.getItem(VISIT_COUNTED)) return
    sessionStorage.setItem(VISIT_COUNTED, '1')
  } catch { return }
  write(VISITS, read(VISITS) + 1)
}

export function countPost() {
  write(POSTS, read(POSTS) + 1)
}

export function shouldSuggestProtecting() {
  if (Date.now() < read(SNOOZED_UNTIL)) return false
  return read(VISITS) >= VISITS_BEFORE_NUDGE || read(POSTS) >= POSTS_BEFORE_NUDGE
}

export function snoozeProtecting() {
  write(SNOOZED_UNTIL, Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000)
}
