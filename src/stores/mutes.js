// Mutes: the standard NIP-51 mute list (kind 10000), so muting follows the
// account to other clients and mutes made elsewhere apply here. Both parts
// count: public tags, and the private part (content, encrypted to yourself).
//
// New mutes go in the private part whenever it can be read and rewritten, so
// the list doesn't show everyone who you muted; otherwise they're public.
// Everything else in the list is carried over untouched. Like bookmarks, it
// refuses to write before the existing list is known.
import { defineStore } from 'pinia'
import { nip04 } from 'nostr-tools'
import { dbMuteList } from '../query'
import ndk, { DEFAULT_RELAYS } from '../nostr/ndk'
import { encryptSelf, decryptSelf } from '../nostr/encryptionService'
import { setMutes } from '../nostr/muteFilter'

const DECRYPTED_KEY = 'astral.mutesPrivate' // { id, tags } of the last private part read
const DECRYPT_TIMEOUT = 8000

let pending = null

function relaysFor(store) {
  const own = Object.keys(store.state.relays || {})
  return [...new Set([...own, ...DEFAULT_RELAYS])]
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))])

async function decryptPrivate(store, content) {
  const pub = store.state.keys.pub
  if (!content.includes('?iv=')) return decryptSelf(store, content) // NIP-44
  // older lists: NIP-04
  if (store.state.keys.priv) return nip04.decrypt(store.state.keys.priv, pub, content)
  if (window.nostr?.nip04?.decrypt) return window.nostr.nip04.decrypt(pub, content)
  if (ndk.signer?.decrypt) return ndk.signer.decrypt({ pubkey: pub }, content)
  throw new Error('no NIP-04 decryption with this signer')
}

function readCache(id) {
  try {
    const c = JSON.parse(localStorage.getItem(DECRYPTED_KEY))
    return c?.id === id ? c.tags : null
  } catch {
    return null
  }
}

function writeCache(id, tags) {
  try { localStorage.setItem(DECRYPTED_KEY, JSON.stringify({ id, tags })) } catch { /* storage blocked */ }
}

export const useMutesStore = defineStore('mutes', {
  state: () => ({
    pubkey: null,
    list: null, // { id, tags, content, created_at } of the newest kind 10000, or null
    privateTags: [], // the decrypted private part
    privateReadable: true, // false: the private part couldn't be read, so it's kept as is
    confirmed: false,
    loading: false,
    saving: false,
  }),

  getters: {
    allTags: (state) => [...(state.list?.tags || []), ...state.privateTags],
    mutedPubkeys() {
      return [...new Set(this.allTags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]))]
    },
    // muted words, hashtags and threads (usually set in other apps)
    otherCount() {
      return this.allTags.filter((t) => ['t', 'word', 'e'].includes(t[0])).length
    },
    isMuted() {
      const set = new Set(this.mutedPubkeys)
      return (pubkey) => set.has(pubkey)
    },
  },

  actions: {
    async load(store, { force = false } = {}) {
      const pubkey = store.state.keys.pub
      if (!pubkey) return
      if (pending) return pending
      if (!force && this.pubkey === pubkey && this.confirmed) return
      pending = this._fetch(store, pubkey).finally(() => { pending = null })
      return pending
    },

    async _fetch(store, pubkey) {
      this.loading = true
      try {
        const { event, answered } = await dbMuteList(pubkey, relaysFor(store))
        if (store.state.keys.pub !== pubkey) return
        if (this.pubkey !== pubkey) { this.list = null; this.privateTags = [] }
        this.pubkey = pubkey
        if (event && (!this.list || event.created_at >= (this.list.created_at || 0))) {
          this.list = { id: event.id, tags: event.tags, content: event.content, created_at: event.created_at }
          await this._readPrivate(store)
        }
        this.confirmed = this.confirmed || !!event || answered
        setMutes(this.allTags)
      } finally {
        this.loading = false
      }
    },

    async _readPrivate(store) {
      const { id, content } = this.list
      this.privateTags = []
      this.privateReadable = true
      if (!content) return
      const cached = readCache(id)
      if (cached) { this.privateTags = cached; return }
      try {
        const tags = JSON.parse(await withTimeout(decryptPrivate(store, content), DECRYPT_TIMEOUT))
        this.privateTags = Array.isArray(tags) ? tags : []
        writeCache(id, this.privateTags)
      } catch (e) {
        console.warn('[mutes] private part unreadable, kept as is', e)
        this.privateReadable = false
      }
    },

    // Mute or unmute one account; resolves true (muted), false (unmuted) or null.
    async setMuted(store, pubkey, muted) {
      await this.load(store)
      if (!this.confirmed) await this.load(store, { force: true })
      if (!this.confirmed) throw new Error('couldn’t load your mute list from your relays, so nothing was changed. try again in a moment.')

      const isP = (t) => t[0] === 'p' && t[1] === pubkey
      let publicTags = (this.list?.tags || []).filter((t) => !isP(t))
      let privateTags = this.privateTags.filter((t) => !isP(t))
      let content = this.list?.content || ''
      const writePrivate = this.privateReadable
      if (muted) {
        if (writePrivate) privateTags = [...privateTags, ['p', pubkey]]
        else publicTags = [...publicTags, ['p', pubkey]]
      }
      if (writePrivate) {
        try {
          content = privateTags.length ? await withTimeout(encryptSelf(store, JSON.stringify(privateTags)), DECRYPT_TIMEOUT) : ''
        } catch (e) {
          // can't encrypt with this signer: the private part stays as it was
          if (!muted && this.privateTags.some(isP)) {
            throw new Error('this account is in the private part of your mute list, which this sign-in can’t rewrite')
          }
          content = this.list?.content || ''
          privateTags = this.privateTags
          if (muted) publicTags = [...publicTags, ['p', pubkey]] // so the new mute goes public
        }
      }

      this.saving = true
      try {
        const signed = await store.dispatch('publishEvent', {
          unpublishedEvent: {
            kind: 10000,
            pubkey: store.state.keys.pub,
            created_at: Math.floor(Date.now() / 1000),
            tags: publicTags,
            content,
          },
        })
        if (!signed) return null
        this.list = { id: signed.id, tags: signed.tags, content: signed.content, created_at: signed.created_at }
        this.privateTags = privateTags
        if (content && this.privateReadable) writeCache(signed.id, privateTags)
        setMutes(this.allTags)
        return muted
      } finally {
        this.saving = false
      }
    },

    reset() {
      this.$reset()
      setMutes([])
      try { localStorage.removeItem(DECRYPTED_KEY) } catch { /* storage blocked */ }
    },
  },
})
