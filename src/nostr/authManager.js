// Signer abstraction for astral, behind one interface, on top of NDK:
//   - NIP-07 browser extension (window.nostr)
//   - "Sign in" with a phone: Cosign's QRST sign-in, or any NIP-46 signer app
//     through the nostrconnect:// fallback in the same code (see signIn.js)
//   - NIP-46 bunker:// pasted by hand
//   - local private key
//
// NIP-46 uses nostr-tools BunkerSigner (not NDKNip46Signer). Root cause of the
// old hang: NDKNip46Signer.sign() relied on startListening() being called, but
// we intentionally bypass blockUntilReady() because it waits for a "connect"
// response that Amber/Primal never send. BunkerSigner.fromBunker() calls
// setupSubscription() immediately, so the sign_event response listener is always
// active. See nip46Signer.js for the NDK adapter.

import { NDKNip07Signer, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { nip19, generateSecretKey } from 'nostr-tools'
import { BunkerSigner } from 'nostr-tools/nip46'
import { hexToBytes } from '@noble/hashes/utils.js'
import { Nip46NdkSigner } from './nip46Signer'
import {
  startSignIn as startPhoneSignIn,
  restoreSignIn as restorePhoneSignIn,
  settleRelays,
  signOut,
  forgetSignIn,
  isCosign,
  moveKeyToPhone
} from './signIn'

const browser = typeof window !== 'undefined'

// localStorage keys
const LS_PUBKEY = 'astral_loggedInPublicKey'
const LS_PRIVKEY = 'astral_privateKey'
const LS_METHOD = 'astral_authMethod'
const LS_NIP46 = 'astral_nip46'
// Left behind by the old nostrconnect pairing; cleared on sign-out.
const LS_NIP46_PENDING = 'astral_nip46_pending'

// authMethod values. 'cosign' and 'nostrconnect' come from the Sign in code;
// 'nip46' is a pasted bunker:// string.
const PHONE_METHODS = ['cosign', 'nostrconnect']

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class AuthManager {
  constructor(ndk) {
    this.ndk = ndk
    this.authState = {
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null
    }
    this.listeners = []
    this.bunkerSigner = null    // remote signer: BunkerSigner or Cosign SignerClient
    this.initializeFromStorage()
  }

  subscribe(listener) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  getState() {
    return { ...this.authState }
  }

  updateState(updates) {
    this.authState = { ...this.authState, ...updates }
    this.listeners.forEach((listener) => listener(this.authState))
  }

  // Make `signer` (anything with signEvent / nip04* / nip44*) the active NDK signer.
  _bindRemoteSigner(signer, userPubkey) {
    this.bunkerSigner = signer
    const user = this.ndk.getUser({ pubkey: userPubkey })
    this.ndk.signer = new Nip46NdkSigner(signer, userPubkey)
    this.ndk.activeUser = user
    return user
  }

  _signedIn(user, publicKey, authMethod) {
    this.updateState({
      isAuthenticated: true,
      user,
      publicKey,
      authMethod,
      isLoading: false,
      error: null
    })
  }

  // ── NIP-46 helpers ───────────────────────────────────────────────────────

  // Create a BunkerSigner and wire it up as ndk.signer.
  // Fires connect non-blocking (Amber never sends a response; awaiting it
  // stalls). getPublicKey is the real readiness signal.
  async _createAndBindBunkerSigner(localPrivateKeyBytes, signerPubkey, relays, secret) {
    const bs = BunkerSigner.fromBunker(localPrivateKeyBytes, { pubkey: signerPubkey, relays, secret })
    // Fire connect but don't await — many signers never acknowledge it.
    bs.connect().catch((e) => console.warn('[NIP-46] connect (non-blocking):', e?.message || e))
    await new Promise((r) => setTimeout(r, 250))

    // Generous timeout: covers bunker processing + user approval in the signer app.
    const userPubkey = await Promise.race([
      bs.getPublicKey(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('get_public_key timed out')), 60000))
    ])

    if (!/^[0-9a-f]{64}$/.test(userPubkey)) throw new Error(`invalid pubkey from bunker: ${userPubkey}`)

    const user = this._bindRemoteSigner(bs, userPubkey)
    return { userPubkey, user, bs }
  }

  // Ask a bunker for its preferred relays (switch_relays) and save them, so the
  // next reload connects where the signer actually listens.
  async _settleBunkerRelays(bs, nip46Info) {
    try {
      const moved = await Promise.race([bs.switchRelays(), new Promise((resolve) => setTimeout(() => resolve(false), 5000))])
      if (moved && JSON.stringify(bs.bp.relays) !== JSON.stringify(nip46Info.relays)) {
        nip46Info.relays = bs.bp.relays
        localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
      }
    } catch (e) {
      console.warn('[NIP-46] switch_relays:', e?.message || e)
    }
  }

  async initializeFromStorage() {
    if (!browser) return
    try {
      const storedPublicKey = localStorage.getItem(LS_PUBKEY)
      const storedPrivateKey = localStorage.getItem(LS_PRIVKEY)
      const storedAuthMethod = localStorage.getItem(LS_METHOD)
      const storedNip46 = localStorage.getItem(LS_NIP46)

      if (PHONE_METHODS.includes(storedAuthMethod) && storedPublicKey) {
        if (this.restoreSignIn(storedPublicKey, storedAuthMethod)) return
        this.clearStorage()
        return
      }

      if (storedAuthMethod === 'nip46' && storedNip46 && storedPublicKey) {
        try {
          await this.reconnectNIP46(JSON.parse(storedNip46))
          return
        } catch (error) {
          console.error('Failed to restore NIP-46 authentication:', error)
          this.clearStorage()
        }
      }

      if (storedPrivateKey && storedPublicKey) {
        try {
          await this.authenticateWithPrivateKey(storedPrivateKey)
        } catch (error) {
          console.error('Failed to restore authentication:', error)
          this.clearStorage()
        }
      } else if (storedPublicKey && storedAuthMethod === 'nip07') {
        this.restoreNIP07(storedPublicKey)
      }
    } catch (error) {
      console.error('Error during authentication initialization:', error)
      this.clearStorage()
    }
  }

  // ── NIP-07 ───────────────────────────────────────────────────────────────

  // Call only from a user's tap: some extensions (Cosign's among them) show
  // their own prompt on the first request from a site, so this can take as
  // long as the user takes. "Not now" rejects with an Error.
  async authenticateWithNIP07() {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      if (!window.nostr) {
        throw new Error(
          'Nostr extension not detected. Please install a compatible extension like Alby or nos2x.'
        )
      }
      const signer = new NDKNip07Signer()
      this.ndk.signer = signer
      const user = await signer.user()
      const publicKey = user.pubkey
      this.ndk.activeUser = user

      this._signedIn(user, publicKey, 'nip07')
      localStorage.setItem(LS_PUBKEY, publicKey)
      localStorage.setItem(LS_METHOD, 'nip07')
      return publicKey
    } catch (error) {
      this.ndk.signer = undefined
      this.failAuth(error, 'Authentication failed')
      throw error
    }
  }

  // A returning visit: the extension already allowed this site, so use the
  // stored public key instead of asking the extension again on page load.
  restoreNIP07(publicKey) {
    this.ndk.signer = new NDKNip07Signer()
    const user = this.ndk.getUser({ pubkey: publicKey })
    this.ndk.activeUser = user
    this._signedIn(user, publicKey, 'nip07')
  }

  // ── local private key ────────────────────────────────────────────────────

  async authenticateWithPrivateKey(privateKey) {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      let pk = privateKey.trim()

      if (pk.startsWith('nsec1')) {
        const decoded = nip19.decode(pk)
        if (decoded.type !== 'nsec') throw new Error('Invalid nsec key format')
        pk = bytesToHex(decoded.data)
      }
      if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
        throw new Error('Invalid private key format - expected 64 hex characters or nsec1 key')
      }

      const signer = new NDKPrivateKeySigner(pk)
      this.ndk.signer = signer
      const user = await signer.user()
      const publicKey = user.pubkey
      this.ndk.activeUser = user

      this._signedIn(user, publicKey, 'privateKey')
      localStorage.setItem(LS_PUBKEY, publicKey)
      localStorage.setItem(LS_PRIVKEY, pk)
      localStorage.setItem(LS_METHOD, 'privateKey')
      return { publicKey, privateKey: pk }
    } catch (error) {
      this.failAuth(error, 'Invalid private key')
      throw error
    }
  }

  // ── Sign in with a phone (Cosign, or nostrconnect fallback) ───────────────

  // Show a code and wait for the phone. `ui` gets code(uri), confirm(text, yes, no)
  // and status(text) calls. Returns { done, cancel }; done resolves to the pubkey.
  startSignIn(ui) {
    this.updateState({ error: null })
    const p = startPhoneSignIn(ui)
    const done = p.done.then(async (signer) => {
      const userPubkey = await signer.getPublicKey()
      if (!/^[0-9a-f]{64}$/.test(userPubkey)) throw new Error(`invalid pubkey from signer: ${userPubkey}`)
      const method = isCosign(signer) ? 'cosign' : 'nostrconnect'
      const user = this._bindRemoteSigner(signer, userPubkey)
      localStorage.setItem(LS_PUBKEY, userPubkey)
      localStorage.setItem(LS_METHOD, method)
      this._signedIn(user, userPubkey, method)
      if (method === 'nostrconnect') settleRelays(signer)
      return userPubkey
    })
    return { done, cancel: p.cancel }
  }

  // "Protect your account": move the key this browser holds into Cosign. When the
  // phone has it, sign in through Cosign as the same account. The caller removes its
  // copy of the key only after `done` resolves; any failure leaves the account as it was.
  moveToPhone(secretKey, expectedPubkey, ui) {
    const p = moveKeyToPhone(secretKey, ui)
    const done = p.done.then(async (signer) => {
      const userPubkey = await signer.getPublicKey()
      if (userPubkey !== expectedPubkey) {
        // Never switch accounts silently. The key wasn't removed, so nothing is lost.
        signer.close()
        throw new Error('Cosign answered for a different account, so nothing was changed.')
      }
      const user = this._bindRemoteSigner(signer, userPubkey)
      localStorage.removeItem(LS_PRIVKEY)
      localStorage.setItem(LS_PUBKEY, userPubkey)
      localStorage.setItem(LS_METHOD, 'cosign')
      this._signedIn(user, userPubkey, 'cosign')
      return userPubkey
    })
    return { done, cancel: p.cancel }
  }

  // Pick up a phone sign-in from a previous visit. Returns false if nothing to restore.
  restoreSignIn(publicKey, method) {
    const signer = restorePhoneSignIn()
    if (!signer) return false
    const user = this._bindRemoteSigner(signer, publicKey)
    this._signedIn(user, publicKey, method)
    if (method === 'nostrconnect') settleRelays(signer)
    return true
  }

  // The phone removed this site (a `revoked:` error from Cosign): sign out
  // locally, without asking the servers to revoke what is already gone.
  handleRevoked() {
    if (this.bunkerSigner?.close) this.bunkerSigner.close()
    this.bunkerSigner = null
    forgetSignIn()
    this.clearStorage()
    this.ndk.signer = undefined
    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: 'You were signed out on your phone.'
    })
  }

  // ── NIP-46 bunker:// pasted by hand ──────────────────────────────────────

  // bunker:// only (nostrconnect:// is client-generated, not user input)
  parseNIP46ConnectionString(connectionString) {
    const trimmed = connectionString.trim()
    if (trimmed.startsWith('nostrconnect://')) {
      throw new Error(
        'nostrconnect:// URIs are for signers to scan. Please use a bunker:// connection string from your signer app.'
      )
    }
    if (trimmed.startsWith('bunker://')) {
      const url = new URL(trimmed)
      let signerPubkey = url.hostname || url.pathname.replace('//', '')
      if (signerPubkey.startsWith('npub1')) {
        const decoded = nip19.decode(signerPubkey)
        if (decoded.type !== 'npub') throw new Error('Invalid npub in connection string')
        signerPubkey = decoded.data
      }
      if (!/^[0-9a-fA-F]{64}$/.test(signerPubkey)) throw new Error('Invalid signer pubkey format')
      const relays = url.searchParams.getAll('relay')
      if (relays.length === 0) throw new Error('No relay specified in connection string')
      const secret = url.searchParams.get('secret') || undefined
      return { signerPubkey, relays, secret }
    }
    if (trimmed.startsWith('npub1')) {
      const parts = trimmed.split(/\s+/)
      const decoded = nip19.decode(parts[0])
      if (decoded.type !== 'npub') throw new Error('Invalid npub format')
      const relays = parts.slice(1).filter((r) => r.startsWith('wss://'))
      if (relays.length === 0) {
        throw new Error('No relay specified. Please add relay URLs after the npub.')
      }
      return { signerPubkey: decoded.data, relays }
    }
    throw new Error('Invalid connection string. Use bunker:// or npub with relay hints.')
  }

  async authenticateWithNIP46(connectionString) {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      const { signerPubkey, relays, secret } = this.parseNIP46ConnectionString(connectionString)

      const localPrivateKeyBytes = generateSecretKey()
      const localPrivateKey = bytesToHex(localPrivateKeyBytes)

      for (const relay of relays) {
        try { this.ndk.addExplicitRelay(relay) } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e)
        }
      }
      await this.ndk.connect()

      const { userPubkey, user, bs } = await this._createAndBindBunkerSigner(
        localPrivateKeyBytes, signerPubkey, relays, secret
      )

      this._signedIn(user, userPubkey, 'nip46')

      const redacted = secret ? connectionString.replace(secret, '***REDACTED***') : connectionString
      const nip46Info = { signerPubkey, userPubkey, relays, connectionString: redacted, localPrivateKey, secret }
      localStorage.setItem(LS_PUBKEY, userPubkey)
      localStorage.setItem(LS_METHOD, 'nip46')
      localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
      this._settleBunkerRelays(bs, nip46Info)
      return userPubkey
    } catch (error) {
      this.bunkerSigner = null
      this.failAuth(error, 'Failed to connect to bunker')
      throw error
    }
  }

  async reconnectNIP46(nip46Info) {
    this.updateState({ isLoading: true, error: null })
    try {
      const localPrivateKey = nip46Info.localPrivateKey || bytesToHex(generateSecretKey())
      const localPrivateKeyBytes = hexToBytes(localPrivateKey)

      for (const relay of nip46Info.relays) {
        try { this.ndk.addExplicitRelay(relay) } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e)
        }
      }
      await this.ndk.connect()

      let userPubkey = nip46Info.userPubkey
      try {
        const result = await this._createAndBindBunkerSigner(
          localPrivateKeyBytes, nip46Info.signerPubkey, nip46Info.relays, nip46Info.secret
        )
        userPubkey = result.userPubkey
        if (nip46Info.userPubkey !== userPubkey) {
          nip46Info.userPubkey = userPubkey
          localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
          localStorage.setItem(LS_PUBKEY, userPubkey)
        }
        this._settleBunkerRelays(result.bs, nip46Info)
      } catch (e) {
        console.warn('[NIP-46] Reconnect failed, using stored pubkey:', e)
        // Restore a minimal signer so signing attempts give a clear error
        // rather than silently hanging.
        this.bunkerSigner = null
        this.ndk.signer = undefined
      }

      const user = this.ndk.getUser({ pubkey: userPubkey })
      if (!this.ndk.activeUser) this.ndk.activeUser = user

      this._signedIn(user, userPubkey, 'nip46')
      return userPubkey
    } catch (error) {
      this.bunkerSigner = null
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: 'Bunker not reachable. Please check your connection or reconnect.'
      })
      throw error
    }
  }

  // ── shared ───────────────────────────────────────────────────────────────

  failAuth(error, fallback) {
    console.error('Authentication failed:', error)
    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: error instanceof Error ? error.message : fallback
    })
  }

  async logout() {
    if (PHONE_METHODS.includes(this.authState.authMethod)) {
      // Cosign: the site leaves the phone's list. Capped so sign-out never hangs.
      await Promise.race([signOut(this.bunkerSigner), new Promise((resolve) => setTimeout(resolve, 15000))])
    } else if (this.bunkerSigner) {
      this.bunkerSigner.close().catch(() => {})
    }
    this.bunkerSigner = null
    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null
    })
    this.clearStorage()
    this.ndk.signer = undefined
    this.ndk.activeUser = undefined
  }

  clearStorage() {
    if (!browser) return
    localStorage.removeItem(LS_PUBKEY)
    localStorage.removeItem(LS_PRIVKEY)
    localStorage.removeItem(LS_METHOD)
    localStorage.removeItem(LS_NIP46)
    localStorage.removeItem(LS_NIP46_PENDING)
    forgetSignIn()
  }

  isNIP07Available() {
    return browser && !!window.nostr
  }
}

// Singleton bound to the app's NDK instance.
let authManager = null
export function createAuthManager(ndk) {
  if (!authManager) authManager = new AuthManager(ndk)
  else authManager.ndk = ndk
  return authManager
}
export function getAuthManager() {
  return authManager
}
