// The few LNURL helpers Astral uses, with the same rules as lnurl-pay's utils.
// Importing lnurl-pay itself pulled bitcoinjs-lib, bolt11, axios and the Node
// crypto shims into the app's startup bundle for these one-liners.
import { bech32 } from '@scure/base'

const LNURL_REGEX = /^(?:http.*[&?]lightning=|lightning:)?(lnurl[0-9]{1,}[02-9ac-hj-np-z]+)/
const LN_ADDRESS_REGEX = /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/

// bech32 lnurl inside a string (also after lightning: or ?lightning=), or null
export function parseLnUrl(url) {
  if (!url) return null
  const result = LNURL_REGEX.exec(url.toLowerCase())
  return result ? result[1] : null
}

export function isLnurl(url) {
  if (!url) return false
  return LNURL_REGEX.test(url.toLowerCase())
}

export function isLightningAddress(address) {
  if (!address) return false
  return LN_ADDRESS_REGEX.test(address)
}

export function parseLightningAddress(address) {
  if (!address) return null
  const result = LN_ADDRESS_REGEX.exec(address)
  return result ? { username: result[1], domain: result[2] } : null
}

function parseLnurlp(url) {
  if (!url) return null
  const parsed = url.toLowerCase()
  if (!LNURLP_REGEX.test(parsed)) return null
  return parsed.replace('lnurlp://', parsed.includes('.onion') ? 'http://' : 'https://')
}

// lnurl, lightning address or lnurlp:// → the LNURL-pay endpoint URL
export function decodeUrlOrAddress(lnUrlOrAddress) {
  const bech32Url = parseLnUrl(lnUrlOrAddress)
  if (bech32Url) {
    const { words } = bech32.decode(bech32Url, 20000)
    return new TextDecoder().decode(bech32.fromWords(words))
  }
  const address = parseLightningAddress(lnUrlOrAddress)
  if (address) {
    const protocol = /\.onion$/.test(address.domain) ? 'http' : 'https'
    return `${protocol}://${address.domain}/.well-known/lnurlp/${address.username}`
  }
  return parseLnurlp(lnUrlOrAddress)
}

// ── LNURL-pay: an invoice for a tip ─────────────────────────────────────────

function lnurlToUrl(lnurl) {
  const s = lnurl.trim()
  if (/^https?:\/\//i.test(s)) return s
  // Lightning address: name@domain → LNURL-pay well-known endpoint
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    const [name, domain] = s.split('@')
    return `https://${domain}/.well-known/lnurlp/${name}`
  }
  // lnurl bech32
  const { words } = bech32.decode(s, 2000)
  const bytes = bech32.fromWords(words)
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

async function fetchLnurlPayMetadata(lnString) {
  const res = await fetch(lnurlToUrl(lnString))
  if (!res.ok) throw new Error(`could not resolve lightning endpoint (${res.status})`)
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'lightning endpoint error')
  if (!data.callback) throw new Error('lightning endpoint missing callback')
  return data // { callback, minSendable, maxSendable, allowsNostr, nostrPubkey, commentAllowed }
}

async function fetchInvoiceFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const reason = body?.reason || body?.message || ''
    throw new Error(`could not fetch invoice (${res.status})${reason ? ': ' + reason : ''}`)
  }
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'invoice error')
  if (!data.pr) throw new Error('no invoice returned')
  return data.pr
}

// Resolve a lightning address / LNURL into a plain bolt11 invoice: a tip, as
// in the original astral (no NIP-57 zap request).
export async function fetchLnurlInvoice(lnStringOrAddress, amountSats, comment = '') {
  if (!amountSats || amountSats <= 0) throw new Error('amount required')
  const meta = await fetchLnurlPayMetadata(lnStringOrAddress)
  const amountMsats = amountSats * 1000
  if (meta.minSendable && amountMsats < meta.minSendable) {
    throw new Error(`minimum is ${Math.ceil(meta.minSendable / 1000)} sats`)
  }
  if (meta.maxSendable && amountMsats > meta.maxSendable) {
    throw new Error(`maximum is ${Math.floor(meta.maxSendable / 1000)} sats`)
  }
  let url = `${meta.callback}${meta.callback.includes('?') ? '&' : '?'}amount=${amountMsats}`
  if (comment && meta.commentAllowed) url += `&comment=${encodeURIComponent(comment.slice(0, meta.commentAllowed))}`
  return fetchInvoiceFromUrl(url)
}
