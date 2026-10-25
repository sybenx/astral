// Translate posts with your own LibreTranslate server. The server URL and an
// optional API key are kept in this browser only; nothing is set by default.
//
// Requests are form-encoded rather than JSON on purpose: a form POST is a
// "simple" CORS request with no preflight, and LibreTranslate behind some
// proxies answers the OPTIONS preflight with an error.

import { reactive } from 'vue'

const KEY = 'astral.libretranslate'

export function getTranslateSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY)) || {}
    return { url: s.url || '', apiKey: s.apiKey || '' }
  } catch {
    return { url: '', apiKey: '' }
  }
}

// https only; returns the normalized URL (no trailing slash) or throws.
export function normalizeServerUrl(raw) {
  const text = (raw || '').trim()
  if (!text) return ''
  let u
  try {
    u = new URL(text)
  } catch {
    throw new Error('that isn’t a valid address')
  }
  if (u.protocol !== 'https:') throw new Error('use an https:// address')
  return u.origin + u.pathname.replace(/\/+$/, '')
}

// shared, so every post's "translate" link follows the setting without a listener each
export const translateState = reactive({ enabled: !!getTranslateSettings().url })

export function saveTranslateSettings({ url, apiKey }) {
  const clean = { url: normalizeServerUrl(url), apiKey: (apiKey || '').trim() }
  try {
    if (clean.url) localStorage.setItem(KEY, JSON.stringify(clean))
    else localStorage.removeItem(KEY)
  } catch { /* storage blocked */ }
  translateState.enabled = !!clean.url
  return clean
}

// The reader's language, e.g. "en" from "en-US".
export function targetLanguage() {
  return (navigator.language || 'en').split('-')[0].toLowerCase()
}

const ENGLISH_WORDS = new Set(('the a an and or but is are was were be been being to of in on for with that this these those it its it\'s ' +
  'you i we they he she my your our their his her us them me not no yes do does did done have has had at by from as so if ' +
  'just what when where why who which how all any some can could will would should about there here then than because ' +
  'like more most one out up get got now think know good great nice thanks thank lol people time only also really very ' +
  'too much many new see make made way well going want need right still even back day').split(' '))

// Common words of the languages most often seen on Nostr besides English
// (es, pt, fr, de, it, nl), minus ones that are also English words.
const OTHER_WORDS = new Set(('el la los las que y en un una por con para es se lo como más pero sus ya este sí porque esta ' +
  'entre cuando muy sin sobre también hasta hay donde desde todo nos uno les ni ese eso ellos esto yo otro mucho nada mi ' +
  'mis tú te tu hoy vamos o os um uma do da dos das em na nas com não mais mas eu ele ela isso muito já hoje ' +
  'le les une des et est qui dans pour pas sur avec ce cette il elle nous vous je au aux du de très ' +
  'der die das und ist nicht ich du er sie es wir ihr ein eine einen mit von zu den dem des auf für im sind war auch ' +
  'noch nach wie aber oder heute dann ' +
  'il lo gli di che è per non su sono come anche più ma ' +
  'het een en van ik je niet dat op te zijn voor met naar om ook maar').split(' '))

// A cheap guess, so a "translate" link isn't offered on every post. Mostly
// non-Latin text (Japanese, Chinese, Korean, Cyrillic, Arabic…) always
// qualifies; other text needs at least five words, and for English readers
// either accents with few English words, or mostly common es/pt/fr/de/it/nl words.
export function looksTranslatable(text, target = targetLanguage()) {
  const clean = (text || '').replace(/https?:\/\/\S+|nostr:\S+|#\w+|@\w+/g, ' ')
  const letters = clean.match(/\p{L}/gu) || []
  if (letters.length < 6) return false
  const latin = clean.match(/\p{Script=Latin}/gu) || []
  if (latin.length / letters.length < 0.7) return !['ja', 'zh', 'ko', 'ru', 'uk', 'ar', 'he', 'el', 'th', 'hi'].includes(target)
  const words = clean.toLowerCase().match(/[\p{L}']+/gu) || []
  if (words.length < 5) return false
  if (target !== 'en') return true
  // accented letters (á ã ç ñ ö ß …) are a strong sign of another language;
  // plain-ASCII text only qualifies with almost no common English words
  const accented = (clean.match(/[^\x00-\x7F]/gu) || []).filter((c) => /\p{Script=Latin}/u.test(c)).length
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length
  const other = words.filter((w) => OTHER_WORDS.has(w)).length / words.length
  if (accented / latin.length > 0.01) return english < 0.25
  return other >= 0.15 && other > english // plain ASCII: only when it clearly reads as another language
}

export async function translate(text, target = targetLanguage()) {
  const { url, apiKey } = getTranslateSettings()
  if (!url) throw new Error('no translation server set')
  const body = new URLSearchParams({ q: text, source: 'auto', target, format: 'text' })
  if (apiKey) body.set('api_key', apiKey)
  // Retry a gateway error or a failed request (a 502 without CORS headers
  // shows up as a network error) up to twice: servers behind a load balancer
  // with one bad backend fail every other request.
  let res = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${url}/translate`, { method: 'POST', body })
      if (![502, 503, 504].includes(res.status)) break
    } catch (e) {
      if (attempt === 2) throw new Error('the server didn’t answer')
    }
  }
  const data = await res?.json().catch(() => null)
  if (!res?.ok || !data?.translatedText) throw new Error(data?.error || `translation failed (${res?.status})`)
  return { text: data.translatedText, from: data.detectedLanguage?.language || null }
}
