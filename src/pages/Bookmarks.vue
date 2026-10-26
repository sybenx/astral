<template>
  <q-page>
    <BaseHeader>{{ $t('bookmarks') }}</BaseHeader>

    <div v-if='!$store.state.keys.pub' class='q-pa-md text-secondary'>sign in to see your bookmarks.</div>
    <div v-else-if='bookmarks.loading && !bookmarks.confirmed' class='row justify-center q-py-md'>
      <q-spinner-orbit color='accent' size='md'/>
    </div>
    <div v-else-if='!bookmarks.ids.length' class='q-pa-md text-secondary'>
      nothing bookmarked yet. use the ⋮ menu on any post to bookmark it.
    </div>
    <div v-else-if='!bookmarks.confirmed' class='q-pa-md text-secondary'>
      couldn’t reach your relays to load your bookmarks. try again in a moment.
    </div>

    <template v-else>
      <div v-for='ev in shown' :key='ev.id'>
        <BasePostThread :events='[ev]' fetch-root-reply/>
      </div>
      <div v-if='shownIds.length < ordered.length' v-intersection='showMore' style='min-height: 1px;'/>
      <div v-if='fetching' class='row justify-center q-py-md'>
        <q-spinner-orbit color='accent' size='md'/>
      </div>
      <div v-else-if='missing' class='q-pa-md text-secondary' style='font-size: .85rem;'>
        {{ missing }} bookmarked {{ missing === 1 ? 'note wasn’t' : 'notes weren’t' }} found on your relays.
      </div>
    </template>
  </q-page>
</template>

<script>
import { defineComponent, markRaw } from 'vue'
import helpersMixin from '../utils/mixin'
import { getEvents } from '../query'
import { DEFAULT_RELAYS } from '../nostr/ndk'
import { useBookmarksStore } from '../stores/bookmarks'

const PAGE = 30 // posts mounted at a time
const BATCH = 50 // ids per relay query

export default defineComponent({
  name: 'Bookmarks',
  mixins: [helpersMixin],

  data() {
    return {
      limit: PAGE,
      events: markRaw(new Map()), // id → event, outside reactivity
      tick: 0, // bumped when `events` changes
      tried: new Set(), // ids already asked for
      fetching: false,
    }
  },

  computed: {
    bookmarks() {
      return useBookmarksStore()
    },
    // newest bookmark first (NIP-51 lists append, so the last tag is the newest)
    ordered() {
      return [...this.bookmarks.ids].reverse()
    },
    shownIds() {
      return this.ordered.slice(0, this.limit)
    },
    shown() {
      void this.tick
      return this.shownIds.map((id) => this.events.get(id)).filter(Boolean)
    },
    missing() {
      void this.tick
      return this.shownIds.filter((id) => this.tried.has(id) && !this.events.has(id)).length
    },
  },

  watch: {
    shownIds() {
      this.fetchShown()
    },
  },

  // kept alive between visits (MainLayout): each visit re-reads the list, for
  // bookmarks made in other apps; posts already here aren't fetched again
  async activated() {
    await this.bookmarks.load(this.$store, { force: true })
    this.fetchShown()
  },

  methods: {
    showMore(entry) {
      if (entry.isIntersecting) this.limit += PAGE
    },

    async fetchShown() {
      if (this.fetching) return
      const want = this.shownIds.filter((id) => !this.tried.has(id))
      if (!want.length) return
      this.fetching = true
      try {
        const relays = [...new Set([...Object.keys(this.$store.state.relays || {}), ...DEFAULT_RELAYS])]
        for (let i = 0; i < want.length; i += BATCH) {
          const ids = want.slice(i, i + BATCH)
          ids.forEach((id) => this.tried.add(id))
          const found = (await getEvents({ ids, relays })) || []
          for (const ev of found) {
            if (!ids.includes(ev.id) || this.events.has(ev.id)) continue
            if (ev.kind === 1 || ev.kind === 2) this.interpolateEventMentions(ev, this.$store)
            this.events.set(ev.id, ev)
            this.$store.dispatch('useProfile', { pubkey: ev.pubkey })
          }
          this.tick++
        }
      } finally {
        this.fetching = false
      }
      this.fetchShown() // anything that scrolled into range meanwhile
    },
  },
})
</script>
