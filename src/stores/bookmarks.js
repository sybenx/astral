// Bookmarks: the standard NIP-51 bookmark list (kind 10003), so they follow the
// account to other clients. Public `e` tags are the bookmarked notes; every
// other tag and the encrypted private part (`content`) are carried over
// untouched on each update.
import { defineStore } from 'pinia'
import { dbBookmarkList } from '../query'
import { DEFAULT_RELAYS } from '../nostr/ndk'

let pending = null // the load in flight, if any

function relaysFor(store) {
  const own = Object.keys(store.state.relays || {})
  return [...new Set([...own, ...DEFAULT_RELAYS])]
}

export const useBookmarksStore = defineStore('bookmarks', {
  state: () => ({
    pubkey: null, // whose list is loaded
    list: null, // { tags, content, created_at } of the newest kind 10003, or null for none
    confirmed: false, // relays answered, so `list === null` really means "no list yet"
    loading: false,
    saving: false,
  }),

  getters: {
    ids: (state) => (state.list?.tags || []).filter((t) => t[0] === 'e' && t[1]).map((t) => t[1]),
    has() {
      const set = new Set(this.ids)
      return (id) => set.has(id)
    },
  },

  actions: {
    async load(store, { force = false } = {}) {
      const pubkey = store.state.keys.pub
      if (!pubkey) return
      if (pending) return pending // one request at a time; callers share it
      if (!force && this.pubkey === pubkey && this.confirmed) return
      pending = this._fetch(store, pubkey).finally(() => { pending = null })
      return pending
    },

    async _fetch(store, pubkey) {
      this.loading = true
      try {
        const { event, answered } = await dbBookmarkList(pubkey, relaysFor(store))
        if (store.state.keys.pub !== pubkey) return // signed out or switched meanwhile
        const newer = event && (!this.list || this.pubkey !== pubkey || event.created_at >= (this.list.created_at || 0))
        if (this.pubkey !== pubkey) this.list = null
        this.pubkey = pubkey
        if (newer) this.list = { tags: event.tags, content: event.content, created_at: event.created_at }
        // An event in hand is confirmation enough; otherwise only a real answer is.
        this.confirmed = this.confirmed || !!event || answered
      } finally {
        this.loading = false
      }
    },

    // Add or remove one note; resolves true (added), false (removed) or null
    // (not saved). Refuses to write before the existing list is known, so a
    // slow relay can never make us publish over someone's bookmarks.
    async toggle(store, eventId) {
      await this.load(store)
      if (!this.confirmed) await this.load(store, { force: true })
      if (!this.confirmed) throw new Error('couldn’t load your bookmarks from your relays, so nothing was changed. try again in a moment.')

      const tags = this.list?.tags || []
      const present = tags.some((t) => t[0] === 'e' && t[1] === eventId)
      const next = present ? tags.filter((t) => !(t[0] === 'e' && t[1] === eventId)) : [...tags, ['e', eventId]]

      this.saving = true
      try {
        const signed = await store.dispatch('publishEvent', {
          unpublishedEvent: {
            kind: 10003,
            pubkey: store.state.keys.pub,
            created_at: Math.floor(Date.now() / 1000),
            tags: next,
            content: this.list?.content || '',
          },
        })
        if (!signed) return null // publishEvent already said why
        this.list = { tags: signed.tags, content: signed.content, created_at: signed.created_at }
        return !present
      } finally {
        this.saving = false
      }
    },

    reset() {
      this.$reset()
    },
  },
})
