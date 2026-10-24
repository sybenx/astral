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
