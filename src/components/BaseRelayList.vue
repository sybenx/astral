<template>
  <div>
    <div>
      <span class="text-bold" style='font-size: 1.1rem;'>relays</span>
      &nbsp;&lpar;
      <span class='text-secondary'>
        <q-icon name='visibility' size='xs' dense/>
        seen
      </span>
      <span>
        <q-icon name='visibility_off' size='xs' dense/>
        not seen
      </span>
      &rpar;
    </div>
    <div style='overflow-x: scroll;'>
      <pre class='relay-list'>
        <div v-if="seenOn.length" class='text-secondary' style='overflow: hidden;'>
          <div v-for="relay in seenOn" :key="relay" class='relay-item hide-scrollbar'>
            <q-icon name='visibility' size='xs'/>
            {{ relay }}
          </div>
        </div>
        <div v-if="missingFrom.length"  style='overflow: hidden;'>
          <div v-for="relay in missingFrom" :key="relay" class='relay-item unseen-relay-item hide-scrollbar' clickable>
            <q-btn
              aria-label='publish to this relay'
              icon='visibility'
              flat
              unelevated
              color="secondary"
              size="sm"
              class='no-padding'
              dense
              @click="publishTo(relay)"
            />
            <q-icon
              name='visibility_off'
              size='xs'
              clickable
            />
            {{ relay }}
          </div>
        </div>
      </pre>
    </div>
  </div>
</template>

<script>
import {publish} from '../query'
import helpersMixin from '../utils/mixin'
import {cleanEvent} from '../utils/event'
import ndk, { connect, DEFAULT_RELAYS } from '../nostr/ndk'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

const bare = (url) => (url || '').replace(/\/+$/, '')

export default {
  name: 'BaseRelayList',
  mixins: [helpersMixin],
  props: {event: {type: Object, required: true}},

  data() {
    return {
      found: [], // relays that answered with this event
      published: [],
      signed: null, // the event with its signature (cached copies have none)
    }
  },

  computed: {
    yourRelays() {
      const own = Object.entries(this.$store.state.relays || {})
      const list = own.length ? own : Object.entries(this.$store.state.defaultRelays || {})
      return list.filter(([_, prefs]) => prefs?.write !== false).map(([url]) => bare(url))
    },
    seenOn() {
      return [...new Set([...(this.event?.seen_on || []), ...this.found, ...this.published].map(bare))]
    },
    // your relays that don't have it (the button publishes it there)
    missingFrom() {
      if (!this.event?.sig && !this.signed) return [] // nothing to republish yet
      return this.yourRelays.filter((url) => !this.seenOn.includes(url))
    },
  },

  mounted() {
    this.checkRelays()
  },

  beforeUnmount() {
    this._sub?.stop()
    clearInterval(this._poll)
  },

  methods: {
    // NDK keeps who delivered an event only for a few minutes, and not for
    // events from the cache: ask your relays (and the defaults) directly.
    async checkRelays() {
      if (!this.event?.id) return
      await connect()
      const urls = [...new Set([...this.yourRelays, ...DEFAULT_RELAYS.map(bare)])]
      const read = () => {
        const seen = ndk.subManager?.seenEvents?.get(this.event.id) || []
        this.found = seen.map((r) => bare(r.url))
      }
      read()
      let rs
      try { rs = NDKRelaySet.fromRelayUrls(urls, ndk) } catch { rs = undefined }
      this._sub = ndk.subscribe(
        { ids: [this.event.id] },
        { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, relaySet: rs, exclusiveRelay: true }
      )
      this._sub.on('event', (e) => {
        const raw = e.rawEvent ? e.rawEvent() : e
        if (raw?.sig && raw.id === this.event.id) this.signed = raw
      })
      this._poll = setInterval(read, 500)
      const done = () => { clearInterval(this._poll); read() }
      this._sub.on('eose', done)
      setTimeout(done, 5000)
    },

    async publishTo(relayURL) {
      const ok = await publish(cleanEvent(this.event.sig ? this.event : this.signed), [relayURL])
      if (ok) this.published = [...this.published, bare(relayURL)]
      else this.$q.notify({ message: `couldn’t publish to ${relayURL}`, color: 'negative' })
    },
  },
}
</script>

<style lang='scss' scoped>
.relay-list {
  column-width: 260px;
  column-gap: 0;
  width: 780px;
  max-height: 100px;
  min-height: 1px;
  font-size: .8rem;
  white-space: nowrap;
}
.relay-item {
  overflow: auto;
}
.unseen-relay-item .q-btn {
  display: none;
  visibility: hidden;
  opacity: .6;
}
.unseen-relay-item:hover .q-btn {
  display: unset;
  visibility: visible;
}
.unseen-relay-item:hover .q-btn:hover {
  opacity: 1;
  }
.unseen-relay-item:hover .q-icon {
  display: none;
  visibility: hidden;
}
// touch screens can't hover: show the publish button outright
@media (hover: none) {
  .unseen-relay-item .q-btn {
    display: unset;
    visibility: visible;
  }
  .unseen-relay-item > .q-icon {
    display: none;
  }
}

</style>

