<template>
  <div
    v-if='!hiddenByMute'
    color='accent'
    class='post-padding cursor-pointer no-hover flex column no-wrap relative-position'
    clickable
    manual-focus
    :class='(hasReply ? "post-has-reply" : "") +
      (isReply ? " post-is-reply" : "") +
      (highlighted ? " post-highlighted" : "") +
      (isChildReply ? " post-is-child-reply" : "") +
      (hasReplyChildren ? " post-has-child-reply" : "")'
    @click.stop="toEvent(event.id)"
  >
      <div v-if="isReply" class="is-reply-connector"></div>
      <div v-if="hasReply" class="has-reply-connector"></div>
      <div
        v-if="replyMode === 'reply'"
        class="has-replying-connector"
        :style='"height: " + (headerHeight + postHeight) + "px;"'
      />
      <div
        ref='hasChildReplyConnector'
        v-if="hasReplyChildren"
        class="has-child-reply-connector"
        style='visibility: hidden;'
        :style='childReplyConnectorStyle()'
      >
        <!-- <div
          v-for="(thread, index) in event.replies"
          :key="thread[0].id"
          ref="hasChildReplyConnectorTick"
          class="has-child-reply-tick"
          :style='childReplyTickStyle(index)'
        /> -->
      </div>
    <div
      ref='postHeader'
      clickable
      avatar
      top
      class='relative-position q-px-xs flex row no-wrap justify-between items-center'
    >
      <div class='flex row no-wrap items-center' style='gap: 1rem;'>
        <BaseUserAvatar
          :pubkey='event.pubkey'
          :size='highlighted ? "lg" : "md"'
          :round='true'
          :bordered='hasReply || isReply || hasReplyChildren || isChildReply'
          :hover-effect='true'
          style='z-index: 1;'
        />
        <div class='q-pb-xs'>
          <q-item-label caption class="text-secondary" style='opacity: .7;'>
            <span @click.stop="toProfile(event.pubkey)">{{ shorten(hexToBech32(event.pubkey, 'npub')) }}</span>
          </q-item-label>
          <q-space/>
          <q-item-label :line='1' clickable>
            <BaseUserName :pubkey="event.pubkey" :show-verified='true' class='text-bold' :show-following='true' :wrap='true'/>
          </q-item-label>
          <q-item-label
            v-if="
              tagged &&
              ($route.name != 'event') &&
              !(isReply || isChildReply)
            "
            class='q-pl-sm'
            style='font-size: .8rem;'
          >
            <span>in reply to&nbsp;</span>
            <a @click.stop="toEvent(tagged)">
              {{ shorten(getNote(tagged)) }}
            </a>
          </q-item-label>
        </div>
      </div>
      <div class='flex row no-wrap items-center post-info' style='z-index: 1;' @click.stop>
        <q-item-label v-if='clientName' class='q-pr-sm gt-xs text-secondary ellipsis' style='opacity: .55; font-size: 75%; max-width: 8rem;'>via {{ clientName }}</q-item-label>
        <q-item-label class='q-pr-xs' style='opacity: .8; font-size: 90%;'>{{ niceDate(event.created_at) }}</q-item-label>
        <q-btn
          flat
          dense
          round
          size='sm'
          color='secondary'
          icon='more_vert'
          aria-label='post menu'
          class='post-menu-button'
          @click.stop
        >
          <q-menu anchor='bottom right' self='top right' @show='onMenuShow'>
            <q-list class='post-menu' style='min-width: 12rem;'>
              <q-item v-if='canBookmark' v-close-popup clickable :disable='bookmarks.saving' @click='toggleBookmark'>
                <q-item-section avatar><q-icon :name='bookmarked ? "bookmark" : "bookmark_border"'/></q-item-section>
                <q-item-section>{{ bookmarked ? 'remove bookmark' : 'bookmark' }}</q-item-section>
              </q-item>
              <q-item v-close-popup clickable @click='copyLink'>
                <q-item-section avatar><q-icon name='link'/></q-item-section>
                <q-item-section>copy link</q-item-section>
              </q-item>
              <q-item v-close-popup clickable @click='sharePost'>
                <q-item-section avatar><q-icon name='share'/></q-item-section>
                <q-item-section>share</q-item-section>
              </q-item>
              <q-item v-if='canMute' v-close-popup clickable :disable='mutes.saving' @click='toggleMute'>
                <q-item-section avatar><q-icon :name='authorMuted ? "volume_up" : "volume_off"'/></q-item-section>
                <q-item-section>{{ authorMuted ? 'unmute' : 'mute' }}</q-item-section>
              </q-item>
              <q-item v-if='canTranslate' v-close-popup clickable @click='translation ? (translation = null) : doTranslate()'>
                <q-item-section avatar><q-icon name='translate'/></q-item-section>
                <q-item-section>{{ translation ? 'hide translation' : 'translate' }}</q-item-section>
              </q-item>
              <q-item clickable>
                <q-item-section avatar><q-icon name='more_horiz'/></q-item-section>
                <q-item-section>more</q-item-section>
                <q-item-section side><q-icon name='chevron_right'/></q-item-section>
                <!-- opens beside the first menu; picking an item closes both -->
                <q-menu anchor='top end' self='top start'>
                  <q-list class='post-menu' style='min-width: 11rem;'>
                    <q-item v-close-popup='2' clickable @click='$refs.infoButton?.toggleMetadataDialog()'>
                      <q-item-section avatar><q-icon name='info'/></q-item-section>
                      <q-item-section>metadata</q-item-section>
                    </q-item>
                    <q-item v-close-popup='2' clickable @click='$refs.relaysButton?.toggleRelayListDialog()'>
                      <q-item-section avatar><q-icon name='sync_alt'/></q-item-section>
                      <q-item-section>seen on relays</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <!-- their dialogs, kept out of the menu so closing it doesn't close them;
             mounted once the menu has been opened -->
        <template v-if='menuUsed'>
          <BaseButtonInfo ref='infoButton' v-show='false' :event='event'/>
          <BaseButtonRelays ref='relaysButton' v-show='false' :event='event'/>
        </template>
        <!-- <q-btn icon='more_vert' dense color='secondary' flat >
          <q-menu
            style='background: var(--q-background); padding: .2rem;'
          >
            <div >
              <BaseButtonInfo
                button-class='text-secondary full-width justify-start no-wrap'
                :event='event'
                :verbose='true'
                size='md'
              />
            </div>
            <div>
              <BaseButtonRelays
                button-class='text-secondary full-width justify-start no-wrap'
                :event='event'
                :verbose='true'
                size='md'
              />
            </div>
          </q-menu>
        </q-btn> -->
        <!-- <BaseButtonRelays
          button-class='text-secondary'
          :event='event'
        />
        <BaseButtonInfo
          button-class='text-secondary'
          :event='event'
        /> -->
        </div>
    </div>
    <div class='flex column no-wrap col full-width'>
      <q-item-section ref='postContent'>
        <div class='q-py-sm q-px-lg'>
        <BaseMarkdown
          v-if="event.kind === 1"
          :content='event.interpolated.text'
          :long-form='isLongForm'
          :imeta='eventImeta'
          @expand='isLongForm = !isLongForm'
          @resized='calcConnectorValues(10)'
        />
        <BaseRelayRecommend v-else-if="event.kind === 2" :url="sanitize(event.content)" />
        <BaseUserCard v-else-if="event.kind === 0" :pubkey='event.pubkey' :header-mode='true' />
        <!-- kind 7: reaction — resolve custom :emoji: shortcodes from tags -->
        <div v-else-if="event.kind === 7" class='reaction-display'>
          <img
            v-if='reactionEmoji.url'
            :src='reactionEmoji.url'
            :alt='reactionEmoji.name'
            style='height: 2.5em; width: auto; vertical-align: middle;'
          />
          <span v-else class='text-h5'>{{ event.content || '+' }}</span>
        </div>
        <!-- kind 6: repost — content is the embedded event JSON; the repost renders
             via the mentionEvents block below, so suppress raw JSON here -->
        <template v-else-if="event.kind === 6" />
        <!-- unknown kinds: show content text, not full raw JSON -->
        <pre v-else style='font-size: .75rem; white-space: pre-wrap; overflow: auto; opacity: .7;'>{{ event.content }}</pre>
        <!-- your own LibreTranslate server (settings), for posts in another language -->
        <div v-if='translation || translating' class='translate-row' @click.stop>
          <template v-if='translation'>
            <div class='translated-text'>{{ translation.text }}</div>
            <span class='translate-meta'>
              translated{{ translation.from ? ' from ' + translation.from : '' }} ·
              <a href='#' class='translate-toggle' @click.prevent='translation = null'>hide translation</a>
            </span>
          </template>
          <span v-else-if='translating' class='translate-meta'>translating…</span>
        </div>
        <div
          v-if='!isEmbeded && (isQuote || isRepost)'
          class='reposts flex column q-pr-md'
          :clickable='false'
        >
          <div
            v-for='(eventId, index) in mentionEvents'
            :key='eventId + "_" + mentionEvents.length + "_" + index'
          >
            <BasePost
              v-if='$store.state.eventsCache[eventId]'
              :event='$store.state.eventsCache[eventId]'
              :manual-focus='false'
              :is-embeded='true'
              @click.stop="toEvent(eventId)"
              @resized='calcConnectorValues(10)'
            />
          </div>
        </div>
        </div>
      <!-- </q-item-label> -->
        <div
          v-if='!isRepost && $store.state.keys.pub && (replyDepth !== -1)'
          class='flex row items-center no-wrap reply-buttons full-width'
          :color="replying ? 'primary' : ''"
        >
          <!-- :class='replying ? "justify-between" : "justify-around"' -->
          <!-- <div v-if='replyMode && replyMode !== "tip"' class='text-primary text-thin col q-pl-xs' style=' font-size: 90%; font-weight: 300;'>{{replyMode}}</div> -->
          <!-- <div class='flex row no-wrap full-width'> -->
            <q-tabs
              :model-value='replyMode'
              @update:model-value='onActionTab'
              class='text-secondary full-width'
              align='justify'
              unelevated
              dense
              flat
              active-color='primary'
              @click.stop
            >
              <!-- reply -->
              <q-tab name='reply' class='no-padding' aria-label='reply'>
                <div class='flex row no-wrap items-center' style='gap: .3rem;'>
                  <q-icon name='chat_bubble_outline' :size='iconSize' class='flip-horizontal'/>
                  <span v-if='replyCount' class='action-count'>{{ replyCount }}</span>
                </div>
                <q-tooltip>reply</q-tooltip>
              </q-tab>

              <!-- like / reaction -->
              <q-tab name='like' class='no-padding' :aria-label='liked ? "reacted" : "react"' @click.stop='sendReaction'>
                <div class='flex row no-wrap items-center' style='gap: .3rem;'>
                  <!-- your own reaction: its custom emoji or emoji if it wasn't a plain like -->
                  <img v-if='myEmoji.url' :src='myEmoji.url' :alt='myEmoji.text' :style='"height: " + iconSize + "; width: auto;"'/>
                  <span v-else-if='myEmoji.text' :style='"font-size: " + iconSize + "; line-height: 1;"'>{{ myEmoji.text }}</span>
                  <q-icon
                    v-else
                    :name='liked ? "favorite" : "favorite_border"'
                    :color='liked ? "pink-4" : ""'
                    :size='iconSize'
                  />
                  <span v-if='shownReactionCount' class='action-count'>{{ shownReactionCount }}</span>
                </div>
                <q-tooltip>{{ liked ? 'reacted' : 'react' }}</q-tooltip>
              </q-tab>

              <!-- repost — tap opens popup: repost | quote -->
              <q-tab name='repost-menu' aria-label='repost' class='no-padding' @click.stop>
                <q-icon name='repeat' :size='iconSize'/>
                <q-tooltip>repost</q-tooltip>
                <q-menu auto-close>
                  <q-list dense style='min-width: 8rem;'>
                    <q-item clickable @click.stop='replyMode = "repost"'>
                      <q-item-section avatar><q-icon name='repeat' size='xs'/></q-item-section>
                      <q-item-section>repost</q-item-section>
                    </q-item>
                    <q-item clickable @click.stop='replyMode = "quote"'>
                      <q-item-section avatar><q-icon name='format_quote' size='xs'/></q-item-section>
                      <q-item-section>quote</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-tab>

              <!-- zap -->
              <q-tab name='zap' class='no-padding' aria-label='tip' @click.stop='$store.getters.profileLud06(event.pubkey) ? showZapDialog = true : null'>
                <div class='flex row no-wrap items-center' style='gap: .3rem;'>
                  <q-icon
                    name='bolt'
                    :size='iconSize'
                    :style='$store.getters.profileLud06(event.pubkey) ? "" : "opacity: .25;"'
                  />
                  <span v-if='zapTotal' class='action-count'>{{ zapTotal >= 1000 ? (zapTotal / 1000).toFixed(1) + "k" : zapTotal }}</span>
                </div>
                <q-tooltip>tip</q-tooltip>
                <q-dialog v-model='showZapDialog' @click.stop>
                  <BaseLightningCard
                    :ln-string='$store.getters.profileLud06(event.pubkey)'
                    :pubkey='event.pubkey'
                    style='padding: 1.5rem;'
                    @paid='showZapDialog = false'
                  />
                </q-dialog>
              </q-tab>

              <!-- embed / link — at the end -->
              <q-tab aria-label='copy event ID' name='embed' class='no-padding'>
                <q-icon name='link' :size='iconSize'/>
                <q-tooltip>copy event ID</q-tooltip>
              </q-tab>

              <!-- cancel active panel -->
              <q-tab name='cancel' aria-label='cancel' v-if='replyMode && replyMode !== "tip"' class='no-padding' @click.stop='replyMode = null'>
                <q-icon name='close' :size='iconSize' color='accent'/>
                <q-tooltip>cancel</q-tooltip>
              </q-tab>
            </q-tabs>
          <!-- </div> -->
        </div>
      </q-item-section>
      <q-item-section v-if="replyMode && replyMode !== 'tip'" class='new-reply-box' ref='replyContent'>
        <q-tab-panels
          v-model="replyPanel"
          class='no-padding full-width overflow-hidden'
          style='background: var(--q-background); max-width: 100%; z-index: 1;'
          @transition='calcConnectorValues(10)'
        >
          <q-tab-panel name="embed" class='no-padding' @click.stop>
            <span class='text-caption'>
              copy the formatted event ID below and paste it in any post to embed this event
            </span>
            <BaseButtonCopy :button-text="getNote(event.id)" color='primary' flat tooltip-text='copy event ID'/>
            <br>
            <span class='text-primary' style='word-break: break-all;'>
              {{ getNote(event.id) }}
            </span>
          </q-tab-panel>
          <q-tab-panel name="reply" class='q-pa-sm'>
            <BasePostEntry
              :event="event"
              :reply-mode='replyMode'
              @sent="replySent"
              @resized='calcConnectorValues(10)'
            />
          </q-tab-panel>
        </q-tab-panels>
      </q-item-section>

      <div v-if='hasReplyChildren && replyDepth !== -1 && event.replies && event.replies.length < 3' class='full-width' style='padding-left: 12px;'>
        <div v-for="thread in event.replies" :key="thread[0].id" ref="childReplyContent">
          <BasePostThread
            :events="thread"
            :reply-depth='replyDepth + 1'
            @resized='calcConnectorValues(10)'
            @add-event='addEvent'
          />
        </div>
      </div>
    </div>
  </div>
  <!-- someone you muted, where a thread or profile still lists the post -->
  <div v-else class='muted-post text-accent' @click.stop='showMuted = true'>
    muted · <span class='text-secondary'>show</span>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import {nextTick} from 'vue'
import {cleanEvent} from '../utils/event'
import helpersMixin from '../utils/mixin'
import BaseButtonRelays from 'components/BaseButtonRelays.vue'
import BaseButtonInfo from 'components/BaseButtonInfo.vue'
import BaseButtonCopy from 'components/BaseButtonCopy.vue'
import BaseMarkdown from 'components/BaseMarkdown.vue'
import BaseRelayRecommend from 'components/BaseRelayRecommend.vue'
import BaseLightningCard from 'components/BaseLightningCard.vue'
import DOMPurify from 'dompurify'
import { fetchReactionsFromCache, fetchZapTotalFromCache } from '../nostr/reactions'
import { useUserStore } from '../stores/user'
import { useBookmarksStore } from '../stores/bookmarks'
import { useMutesStore } from '../stores/mutes'
import { muteState, isMutedEvent } from '../nostr/muteFilter'
import { myReactionFor, checkMyReaction, setMyReaction } from '../nostr/myReactions'
import { translateState, looksTranslatable, translate } from '../utils/translate'
import { Notify, copyToClipboard } from 'quasar'
import { nip19 } from 'nostr-tools'

export default defineComponent({
  name: 'BasePost',
  emits: ['resized', 'add-event', 'mounted'],
  mixins: [helpersMixin],
  props: {
    event: {type: Object, required: true},
    highlighted: {type: Boolean, default: false},
    position: {type: String, default: 'standalone'},
    replyDepth: {type: Number, default: 0},
    replyCount: {type: Number, default: 0},
    isEmbeded: {type: Boolean, default: false},
  },
  components: {
    BaseButtonRelays,
    BaseButtonInfo,
    BaseButtonCopy,
    BaseMarkdown,
    BaseRelayRecommend,
    BaseLightningCard,
  },

  data() {
    return {
      showMuted: false, // shown anyway after "show" on a muted post
      translation: null, // { text, from } once translated
      translating: false,
      menuUsed: false,
      clicking: false,
      replying: false,
      childReplyHeights: [],
      postHeight: 0,
      replyHeight: 0,
      reposts: [],
      eventSub: null,
      replyMode: '',
      resizing: false,
      trigger: 1,
      isLongForm: false,
      reactionCount: 0,
      hasReacted: false,
      reactSending: false,
      showZapDialog: false,
      zapTotal: 0,
    }
  },

  computed: {
    bookmarks() {
      return useBookmarksStore()
    },
    // signed in with something that can sign (not a watch-only public key)
    canBookmark() {
      return !!this.$store.state.keys.pub && useUserStore().canSign && this.event.kind !== 4
    },
    bookmarked() {
      return this.bookmarks.has(this.event.id)
    },
    mutes() {
      return useMutesStore()
    },
    // someone else's post, and signed in with something that can sign
    canMute() {
      return this.canBookmark && this.event.pubkey !== this.$store.state.keys.pub
    },
    authorMuted() {
      return this.mutes.isMuted(this.event.pubkey)
    },
    hiddenByMute() {
      void muteState.version
      return !this.showMuted && isMutedEvent(this.event)
    },
    canTranslate() {
      return translateState.enabled && this.event.kind === 1 && looksTranslatable(this.event.content)
    },
    iconSize() {
      return this.highlighted ? '22px' : '18px'
    },

    // NIP-92 imeta: Map<url, {mimeType, alt}> parsed from ["imeta", "url <u>", "m <mime>", "alt <text>"] tags
    eventImeta() {
      const tags = this.event.tags || []
      const imetaTags = tags.filter(t => t[0] === 'imeta')
      if (!imetaTags.length) return null
      const map = new Map()
      for (const tag of imetaTags) {
        let url = null, mimeType = null, alt = null
        for (let i = 1; i < tag.length; i++) {
          const [key, ...rest] = tag[i].split(' ')
          const val = rest.join(' ')
          if (key === 'url') url = val
          else if (key === 'm') mimeType = val
          else if (key === 'alt') alt = val
        }
        if (url) map.set(url, { mimeType, alt })
      }
      return map.size ? map : null
    },

    // NIP-89 client tag: ["client", "<name>", ...] — shown as "via <name>"
    clientName() {
      const tag = (this.event.tags || []).find((t) => t[0] === 'client' && t[1])
      return tag ? tag[1] : ''
    },
    tagged() {
      let replyTags = this.event.interpolated?.replyEvents
      if (replyTags?.length) return replyTags[replyTags.length - 1]
      return null
    },
    taggedPubkeys() {
      let pubkeyTags = this.event.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])
      if (pubkeyTags?.length) return pubkeyTags
      return null
    },

    // your own reaction to this post, found on relays (null: none; undefined: not checked yet)
    myReaction() {
      return myReactionFor(this.$store, this.event.id)
    },
    liked() {
      return this.hasReacted || (!!this.myReaction && this.myReaction.content !== '-')
    },
    // the emoji to show instead of the heart, when your reaction wasn't a plain like
    myEmoji() {
      const content = (this.myReaction?.content || '').trim()
      if (!content || content === '+' || content === '-') return { url: null, text: null }
      const m = content.match(/^:([^:]+):$/)
      if (m) {
        const tag = (this.myReaction.tags || []).find(([t, n]) => t === 'emoji' && n === m[1])
        return tag?.[2] ? { url: tag[2], text: content } : { url: null, text: null }
      }
      return { url: null, text: [...content].slice(0, 2).join('') }
    },
    // the cached count, plus your own reaction when only the relays had it
    shownReactionCount() {
      return this.reactionCount + (this.liked && !this.hasReacted ? 1 : 0)
    },
    reactionEmoji() {
      const content = (this.event.content || '').trim()
      const m = content.match(/^:([^:]+):$/)
      if (m) {
        const tag = (this.event.tags || []).find(([t, n]) => t === 'emoji' && n === m[1])
        if (tag?.[2]) return { url: tag[2], name: m[1] }
      }
      return { url: null, name: null }
    },

    isRepost() {
      return this.event.interpolated?.text === '' &&
        this.event.interpolated.mentionEvents.length
    },

    isQuote() {
      return this.event.interpolated?.text &&
        this.event.interpolated.mentionEvents.length
    },

    mentionEvents() {
     return this.event.interpolated?.mentionEvents
    },

    isReply() {
      return this.position === 'middle' || this.position === 'last'
    },

    hasReply() {
      return this.position === 'middle' || this.position === 'first'
    },

    isChildReply() {
      if (this.replyDepth) return true
      return false
    },

    hasReplyChildren() {
      if (this.event.replies && this.event.replies.length > 0 && this.event.replies.length < 3) return true
      return false
    },

    postContentWidth() {
      if (this.resizing) return this.$refs.postContent?.$el?.clientWidth
      return this.$refs.postContent?.$el?.clientWidth
    },

    postContentHeight() {
      // only including if statement to trigger recalc on resize
      if (this.resizing) return this.$refs.postContent?.$el?.clientHeight
      return this.$refs.postContent?.$el?.clientHeight
    },

    replyContentHeight() {
      // only including if statement to trigger recalc on resize
      if (this.replyMode && this.resizing && this.$refs.replyContent?.$el) return this.$refs.replyContent?.$el?.clientHeight
      else return this.$refs.replyContent?.$el?.clientHeight || 0
    },

    replyPanel() {
      if (this.replyMode === 'embed') return 'embed'
      else if (this.replyMode) return 'reply'
      else return ''
    },

    cleanEvent() {
      return this.sanitize(JSON.stringify(cleanEvent(this.event), null, 2))
    },
  },

  watch: {
    // signed in (or switched account) with this post already on screen
    '$store.state.keys.pub'(pub) {
      if (pub && !this.isEmbeded && this.event.kind === 1) checkMyReaction(this.$store, this.event.id)
    },
  },

  mounted() {
    if (!this.isEmbeded && (this.isQuote || this.isRepost)) {
      if (!Array.isArray(this.reposts)) this.reposts = []
      this.processTaggedEvents(this.mentionEvents, this.reposts)
    }
    this.calcConnectorValues()
    this.$emit('mounted')
    this.isLongForm = this.event.content.length > 600 || this.event.content.split(/\r\n|\r|\n/).length > 10
    if (!this.isEmbeded && this.event.kind === 1) {
      this.loadReactions()
      this.loadZaps()
      if (this.$store.state.keys.pub) checkMyReaction(this.$store, this.event.id)
    }
  },

  activated() {
    this.calcConnectorValues()
    this.trigger++
  },

  // deactivated() {
  //   if (this.reposts.length) {
  //     for (let event of this.reposts) this.$store.dispatch('cancelUseProfile', {pubkey: event.pubkey})
  //   }
  // },

  methods: {
    onMenuShow() {
      this.menuUsed = true
      if (this.canBookmark) this.bookmarks.load(this.$store)
    },

    // a plain web link anyone can open, Nostr app or not
    postLink() {
      const nevent = nip19.neventEncode({ id: this.event.id, author: this.event.pubkey, kind: this.event.kind })
      return `https://njump.me/${nevent}`
    },

    copyLink() {
      copyToClipboard(this.postLink()).then(() => Notify.create({ message: 'link copied' }))
    },

    async sharePost() {
      const url = this.postLink()
      if (navigator.share) {
        try {
          await navigator.share({ url })
          return
        } catch (e) {
          if (e?.name === 'AbortError') return // closed the share sheet
        }
      }
      this.copyLink()
    },

    async doTranslate() {
      this.translating = true
      try {
        this.translation = await translate(this.event.content)
      } catch (e) {
        Notify.create({ message: `couldn’t translate: ${e?.message || e}`, color: 'negative' })
      } finally {
        this.translating = false
      }
    },

    async toggleBookmark() {
      try {
        const added = await this.bookmarks.toggle(this.$store, this.event.id)
        if (added !== null) Notify.create({ message: added ? 'bookmarked' : 'bookmark removed' })
      } catch (e) {
        Notify.create({ message: e?.message || String(e), color: 'negative' })
      }
    },

    // The action bar is a q-tabs, but only reply and the link tab open a panel.
    // Like, repost (its own menu), zap (its dialog) and cancel act on their own;
    // letting them become the tabs' value opened an empty reply editor.
    onActionTab(name) {
      if (name === 'reply' || name === 'embed') this.replyMode = name
    },

    async toggleMute() {
      const mute = !this.authorMuted
      try {
        const done = await this.mutes.setMuted(this.$store, this.event.pubkey, mute)
        if (done === null) return
        Notify.create({
          message: mute ? 'muted' : 'unmuted',
          actions: mute ? [{ label: 'undo', color: 'secondary', handler: () => this.mutes.setMuted(this.$store, this.event.pubkey, false) }] : [],
        })
      } catch (e) {
        Notify.create({ message: e?.message || String(e), color: 'negative' })
      }
    },

    async loadReactions() {
      const myPub = this.$store.state.keys.pub
      const reactions = await fetchReactionsFromCache(this.event.id)
      this.reactionCount = reactions.length
      this.hasReacted = myPub ? reactions.some((r) => r.pubkey === myPub) : false
    },

    async loadZaps() {
      this.zapTotal = await fetchZapTotalFromCache(this.event.id)
    },

    async sendReaction() {
      if (this.liked || this.reactSending || !this.$store.state.keys.pub) return
      this.reactSending = true
      // shown at once, taken back if it can't be sent
      this.hasReacted = true
      this.reactionCount++
      try {
        // not checked yet whether you reacted before (here or in another app):
        // wait for that, so a second tap never publishes a duplicate
        if (this.myReaction === undefined) {
          await checkMyReaction(this.$store, this.event.id)
          if (this.myReaction && this.myReaction.content !== '-') {
            this.hasReacted = false
            this.reactionCount = Math.max(0, this.reactionCount - 1)
            return
          }
        }
        const userStore = useUserStore()
        await userStore.publishEvent({
          pubkey: this.$store.state.keys.pub,
          created_at: Math.floor(Date.now() / 1000),
          kind: 7,
          tags: [
            ['e', this.event.id],
            ['p', this.event.pubkey],
            ['k', String(this.event.kind)],
          ],
          content: '+',
        })
        setMyReaction(this.$store, this.event.id, '+')
      } catch (err) {
        this.hasReacted = false
        this.reactionCount = Math.max(0, this.reactionCount - 1)
        this.$q.notify({ message: err?.message || 'couldn’t send the reaction', color: 'negative' })
      } finally {
        this.reactSending = false
      }
    },

    childReplyConnectorStyle() {
      if (this.childReplyHeights?.length) {
        let height = this.headerHeight + this.postHeight + this.childReplyHeights.slice(0, -1).reduce((c, p) => c + p, 0)
        height = height + (this.isChildReply ? 12 : 22)
        if (this.replyHeight) height += this.replyHeight
        return 'visibility: visible; height: ' + height + 'px'
      } else return ''
    },

    // childReplyTickStyle(index) {
    //   if (this.childReplyHeights?.length) {
    //     let offset = this.postHeight + this.childReplyHeights.filter((_, i) => i < index).reduce((c, p) => c + p, 0)
    //     if (this.replyHeight) offset += this.replyHeight
    //     return 'visibility: visible; top: ' + offset + 'px'
    //   } else return ''
    // },

    calcConnectorValues(time = 2000) {
      this.resizing = !this.resizing
      nextTick(() => {
        setTimeout(() => {
          this.headerHeight = this.$refs.postHeader ? this.$refs.postHeader.clientHeight : 0
          this.postHeight = this.postContentHeight
          this.replyHeight = this.replyContentHeight
          if (this.hasReplyChildren) {
            this.childReplyHeights = this.$refs.childReplyContent?.map((div) => div.clientHeight)
          }
          this.$emit('resized')
        }, time)
      })
    },

    toggleReplying() {
      if (this.replyMode === '') {
        this.replying = true
        this.replyMode = 'reply'
      } else {
        this.replyMode = ''
        this.replying = false
      }
      this.calcConnectorValues(10)
    },

    replySent(event) {
      this.replying = false
      this.replyMode = ''
      this.$emit('add-event', event)
    },

    niceDate(timestamp) {
      if (this.trigger) return this.niceDateUTC(timestamp)
      return this.niceDateUTC(timestamp)
    },

    addEvent(event) {
      // console.log('post reply threads add-event', event)
      this.$emit('add-event', event)
    },

    sanitize(text) {
      return DOMPurify.sanitize(text)
    }
  }
})
</script>
<style lang="css" scoped>
.muted-post {
  padding: .5rem 1rem;
  font-size: .85rem;
  cursor: pointer;
}
.action-count {
  font-size: 0.7rem;
  line-height: 1;
  margin-left: 2px;
  opacity: 0.85;
}
.reaction-display {
  padding: 0.25rem 0;
  text-align: center;
}
.post-padding {
  box-sizing: border-box;
  /*
  border-bottom: 1px dotted var(--q-accent);
  */
  padding: 1rem 0;
  margin-top: 0;
  width: 100%;
  min-width: 100%;
  max-width: 100%;
  overflow: hidden;
  font-size: .9rem;
}
.post-highlighted {
  width: '100%';
  font-size: 1.2rem;
  border: 0;
}
.post-highlighted .reposts {
  font-size: .9rem;
  max-width: 100%;
}
.reposts {
  margin: .5rem .5rem 0 0;
}
.reposts .post-padding {
  border: 0;
}
.post-is-reply,
.post-has-reply,
.post-is-child-reply,
.post-has-child-reply {
}
.post-is-child-reply,
.post-has-reply {
  border-bottom: 0;
}
.post-is-child-reply {
  padding: .5rem 0;
}
.has-reply-connector,
.is-reply-connector,
.has-child-reply-connector,
.has-child-reply-tick {
  opacity: .3;
}
.has-reply-connector {
  width: 8px;
  position: absolute;
  left: 5px;
  height: 100%;
  top: 1.5rem;
  background: var(--q-accent);
  z-index: 0;
}
.is-reply-connector {
  width: 8px;
  position: absolute;
  left: 5px;
  height: 2rem;
  top: 0;
  background: var(--q-accent);
  z-index: 0;
}
.has-replying-connector {
  width: 8px;
  position: absolute;
  left: 5px;
  top: 1.5rem;
  background: var(--q-accent);
  z-index: 0;
  opacity: .3;
}
.post-highlighted .has-replying-connector {
  top: 2.5rem;
}
.has-child-reply-connector {
  width: 8px;
  position: absolute;
  left: 5px;
  top: 1.5rem;
  background: var(--q-accent);
  z-index: 0;
  border-radius: 4px;

}
.has-child-reply-tick {
  display: none;
  width: .55rem;
  height: 5px;
  position: absolute;
  left: 5px;
  background: var(--q-accent);
  z-index: 0;
}

.new-reply-box {
  border: 1px solid var(--q-primary);
  border-radius: .5rem;
  margin: 0 .3rem 1rem .3rem;
  padding: .3rem;
  z-index: 1;
  background: var(--q-background);
}

@media screen and (min-width: 600px) {
}

.translate-row {
  padding: 0 1.5rem;
}
.translate-toggle {
  min-height: 44px;
}
.translated-text {
  white-space: pre-wrap;
  padding: .25rem 0;
  border-left: 2px solid var(--q-accent);
  padding-left: .5rem;
}
.translate-meta {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  font-size: .8rem;
  color: var(--q-secondary);
}
.translate-meta a {
  display: inline-flex;
  align-items: center;
  color: var(--q-primary);
}
</style>

<style lang="css">
.reposts {
  border-radius: .75rem;
  box-shadow: 0 0 .3rem -.0rem var(--q-accent);
  min-width: 150px;
}
</style>

