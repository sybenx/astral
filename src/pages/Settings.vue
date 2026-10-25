<template>
  <q-page id='settings-page'>
    <BaseHeader>{{ $t('settings') }}</BaseHeader>
    <q-form class="q-gutter-md section" @submit="setMetadata">
      <div v-if='editingMetadata' class='flex justify-between' style='display: flex; gap: .2rem;'>
        <q-btn label="save" color="primary" outline size="sm" type="submit"/>
        <q-btn label="cancel" color="negative" outline size="sm" @click='cancel("metadata")'/>
      </div>
      <div class="text-bold flex justify-between no-wrap" style='font-size: 1.1rem;'>
          {{ $t('profile') }}
          <q-btn v-if='!editingMetadata' label="edit" color="primary" outline size="sm" :disable="!$store.getters.canSignEventsAutomatically" @click='editingMetadata = true'/>
      </div>
      <q-input v-model="metadata.name" dense filled type="text" label="Name" :disable='!editingMetadata'>
        <template #before>
          <q-icon name="alternate_email" />
        </template>
      </q-input>
      <q-input
        v-model="metadata.about"
        :disable='!editingMetadata'
        filled
        autogrow
        dense
        type="text"
        label="About (in 150 chars)"
        maxlength="300"
      />
      <q-input
        v-model.trim="metadata.picture"
        :disable='!editingMetadata'
        filled
        dense
        type="text"
        label="Picture URL"
        maxlength="150"
      >
        <template #after>
          <BaseUserAvatar v-if="metadata.picture" :pubkey='$store.state.keys.pub' rounded/>
        </template>
      </q-input>
      <q-input
        v-model.trim="metadata.nip05"
        :disable='!editingMetadata'
        filled
        dense
        type="text"
        label="NIP-05 Identifier"
        maxlength="100"
      />
      <div class='flex row no-wrap' style='gap: 1rem;'>
        <q-input
          v-model.trim="metadata.lud06"
          :disable='!editingMetadata'
          filled
          dense
          type="text"
          label="Lightning Address or LUD-06 Identifier"
          maxlength="150"
          class='full-width'
        />
        <q-btn v-if='hasLnAddr' :label='showLnAddr ? "show lnurl" : "show ln address"' @click='convertLud06' outline dense no-wrap/>
      </div>
    </q-form>

    <q-separator color='accent'/>
      <ThePreferences @update-font='updateFont'/>
    <q-separator color='accent'/>
    <div class='section'>
      <div v-if='editingRelays' class='flex justify-between' style='display: flex; gap: .2rem;'>
        <q-btn label="save" color="primary" outline size="sm" @click='saveRelays'/>
        <q-btn label="cancel" color="negative" outline size="sm" @click='cancel("relays")'/>
      </div>
      <div class="text-bold flex justify-between no-wrap" style='font-size: 1.1rem;'>
        {{ $t('relays') }}
        <div class="text-normal flex row no-wrap" style='font-size: .9rem; gap: .4rem;'>
          <q-btn v-if='!editingRelays' label="edit" color="primary" outline size="sm" :disable="!$store.getters.canSignEventsAutomatically" @click='editingRelays = true'/>
          <div v-if='editingRelays'>read</div>
          <div v-if='editingRelays'>write</div>
        </div>
      </div>
      <q-list class='flex column q-pt-xs' style='gap: .2rem;'>
        <q-item
          v-for="(url) in Object.keys(relays)"
          :key="url"
          class='flex justify-between items-center no-wrap no-padding'
          style='min-height: 1.2rem'
        >
          <div>
              <q-btn
                v-if='!editingRelays && (relays[url].read || relays[url].write)'
                color="secondary"
                outline
                size="sm"
                label="Share"
                :disable="
                  hasJustSharedRelay ||
                  !$store.getters.canSignEventsAutomatically
                "
                @click="shareRelay(url)"
              />
              <q-btn
                v-if='editingRelays'
                color="negative"
                label='remove'
                outline
                size="sm"
                @click="removeRelay(url)"
              />
              {{ url }}
          </div>
          <div class="flex no-wrap items-center" style='gap: .6rem;'>
              <q-toggle
                v-if='editingRelays'
                v-model='relays[url].read'
                color='primary'
                size='sm'
                dense
                class='no-padding'
                :disable="!$store.getters.canSignEventsAutomatically"
              />
              <q-toggle
                v-if='editingRelays'
                v-model='relays[url].write'
                color='primary'
                size='sm'
                dense
                class='no-padding'
                :disable="!$store.getters.canSignEventsAutomatically"
              />
          </div>
        </q-item>
      </q-list>
      <q-form v-if='editingRelays' class='q-py-xs' @submit="addRelay">
          <div class='flex row no-wrap q-mx-sm q-mt-sm' id='new-relay-input'>
            <q-input v-model='newRelay' placeholder='add a relay...' autofocus class='full-width' input-style='padding: 0;' @keypress.enter='addRelay' dense borderless/>
            <q-btn icon='add' aria-label='add relay' color='positive' size='sm' flat dense @click.stop='addRelay'/>
          </div>
        <BaseSelectMultiple>
          <template #options>
            <div style='max-height: 6.75rem;'>
            <pre class='relay-list' >
              <li
                v-for='(relay, index) in optionalRelays'
                :key='index + "-" + relay'
                class='relay-item'
                @click.stop='relays[relay]={read: true, write: true}'
              >
                <div class='flex row justify-between no-wrap'>
                  <span style='overflow: auto;'>{{relay}}</span>
                  <q-icon name='add' size='xs' color='positive' flat/>
                </div>
              </li>
            </pre>
            </div>
          </template>
        </BaseSelectMultiple>
      </q-form>
    </div>

    <q-separator color='accent'/>
    <div class='section'>
      <div class="text-bold" style='font-size: 1.1rem;'>translate</div>
      <p class='text-secondary q-my-xs' style='font-size: .85rem;'>
        translate with your own libretranslate server. posts in other languages then get a “translate” link.
        saved in this browser only.
      </p>
      <q-form class='flex column' style='gap: .5rem;' @submit.prevent='saveTranslate'>
        <q-input
          v-model='translateUrl'
          dense
          outlined
          type='url'
          inputmode='url'
          autocomplete='off'
          label='server address (https://…)'
          :error='!!translateError'
          :error-message='translateError'
        />
        <q-input v-model='translateKey' dense outlined type='password' autocomplete='off' label='api key (optional)'/>
        <div class='flex row items-center' style='gap: .5rem;'>
          <q-btn type='submit' outline no-caps color='primary' label='save' :loading='translateTesting' style='min-height: 44px;'/>
          <q-btn v-if='translateSaved' flat no-caps color='secondary' label='remove' style='min-height: 44px;' @click='clearTranslate'/>
          <span v-if='translateStatus' class='text-secondary' style='font-size: .85rem;'>{{ translateStatus }}</span>
        </div>
      </q-form>
    </div>

    <q-separator color='accent'/>
    <div class='section'>
      <div class="text-bold" style='font-size: 1.1rem;'>muted</div>
      <div class='text-secondary q-mb-sm' style='font-size: .85rem;'>
        your mute list is shared with other nostr apps. mute someone from the ⋯ menu on their post.
      </div>
      <div v-if='mutes.loading && !mutes.confirmed' class='text-secondary' style='font-size: .85rem;'>loading…</div>
      <div v-else-if='!mutes.mutedPubkeys.length' class='text-secondary' style='font-size: .85rem;'>nobody muted.</div>
      <div v-for='pk in mutes.mutedPubkeys' :key='pk' class='flex row no-wrap items-center justify-between'>
        <BaseUserCard :pubkey='pk' :action-buttons='false' class='col'/>
        <q-btn flat no-caps color='secondary' label='unmute' :disable='mutes.saving' style='min-height: 44px;' @click='unmute(pk)'/>
      </div>
      <div v-if='mutes.otherCount' class='text-secondary q-mt-xs' style='font-size: .85rem;'>
        plus {{ mutes.otherCount }} muted {{ mutes.otherCount === 1 ? 'word, hashtag or thread' : 'words, hashtags or threads' }} from other apps, which apply here too.
      </div>
      <div v-if='!mutes.privateReadable' class='text-secondary q-mt-xs' style='font-size: .85rem;'>
        the private part of your list couldn’t be read with this sign-in; it’s kept as it is.
      </div>
    </div>

    <q-separator color='accent'/>
      <q-expansion-item
        dense
        expand-icon='help'
        expanded-icon='expand_less'
        class="full-width items-center"
        header-class='items-center'
      >
        <template #header>
          <div class="text-bold flex justify-between no-wrap full-width" style='font-size: 1.1rem;'>{{ $t('faq') }}</div>
        </template>
        <q-card-section>
        <BaseInformation/>
        </q-card-section>
      </q-expansion-item>
    <q-separator color='accent'/>

    <div class="flex no-wrap section" style='gap: .2rem;'>
      <q-btn label="View your keys" color="primary" outline @click="keysDialog = true" />
      <q-btn label="logout" color="primary" outline @click="logout" />
      <q-btn label="Delete Local Data" color="negative" outline @click="hardReset" />
      <q-btn label="dev tools" color='secondary' outline :to='{ name: "devTools"}' />
    </div>

    <q-dialog v-model="keysDialog">
      <q-card class="px-4 py-2">
        <q-card-section>
          <div class="text-lg text-bold tracking-wide leading-relaxed py-2">
            Your keys <q-icon name="vpn_key" />
          </div>
          <template v-if="authMethod === 'privateKey'">
            <p class='text-warning'>Make sure you back up your private key! Anyone with it controls your account.</p>
          </template>
          <template v-else-if="authMethod === 'nip07'">
            <p>You're signed in with a <strong>browser extension</strong>. Your private key stays in the extension — Astral never sees it. This is the secure setup, so there's nothing to back up here.</p>
          </template>
          <template v-else-if="authMethod === 'cosign'">
            <p>You're signed in with <strong>your phone</strong> through your signer app. Your key is split between your phone and your servers — Astral never sees it. You can remove Astral from the app's list at any time, and logging out here removes it too.</p>
          </template>
          <template v-else-if="authMethod === 'nip46' || authMethod === 'nostrconnect'">
            <p>You're signed in with a <strong>remote signer</strong>. Your private key stays in your signer — Astral never sees it. This is the secure setup, so there's nothing to back up here.</p>
          </template>
          <template v-else>
            <p>You're signed in with a <strong>public key only</strong> (read-only). To publish, sign in with your private key, a browser extension, or a remote signer.</p>
          </template>
          <div class="mt-1 text-xs">
            Others can see your posts or follow you using only your public key.
          </div>
        </q-card-section>

        <q-card-section>
          <template v-if="authMethod === 'privateKey'">
            <p>Private Key:</p>
            <q-input v-model="nsecKey" class="mb-2" readonly filled />
          </template>
          <p>Public Key:</p>
          <q-input v-model="npubKey" readonly filled />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
          <q-btn v-close-popup outline label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import {LocalStorage} from 'quasar'
import {nextTick} from 'vue'
import {nip05} from 'nostr-tools'

import helpersMixin from '../utils/mixin'
// import { setCssVar } from 'quasar'
// import BaseSelect from 'components/BaseSelect.vue'
import BaseSelectMultiple from 'components/BaseSelectMultiple.vue'
import BaseInformation from 'components/BaseInformation.vue'
import ThePreferences from 'components/ThePreferences.vue'
import { createMetaMixin, Notify } from 'quasar'
import * as utils from '../utils/lnurl'
import { getAuthManager } from '../nostr/authManager'
import { getTranslateSettings, saveTranslateSettings, normalizeServerUrl, translate } from '../utils/translate'
import ndk from '../nostr/ndk'
import { useMutesStore } from '../stores/mutes'

const metaData = {
  // sets document title
  title: 'astral - settings',

  // meta tags
  meta: {
    description: { name: 'description', content: 'Nostr and astral user configuration' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default {
  name: 'Settings',
  mixins: [helpersMixin, createMetaMixin(metaData)],
  emits: ['update-font'],
  components: {
    // BaseSelect,
    BaseSelectMultiple,
    BaseInformation,
    ThePreferences,
  },

  data() {
    const t = getTranslateSettings()
    return {
      translateUrl: t.url,
      translateKey: t.apiKey,
      translateSaved: !!t.url,
      translateTesting: false,
      translateError: '',
      translateStatus: '',
      keysDialog: false,
      editingMetadata: false,
      metadata: {},
      showLnAddr: true,
      relays: {},
      editingRelays: false,
      // editingPreferences: false,
      choosingFont: false,
      choosingTheme: false,
      // preferences: {},
      newRelay: '',
      unsubscribe: null,
      hasJustSharedRelay: false,
    }
  },

  // props: {
  //   showKeys: {
  //     type: Boolean,
  //     default: false
  //   }
  // },

  watch: {
    '$store.state.relays'(curr, prev) {
      if (curr !== prev) this.cloneRelays()
    },
  },
  computed: {
    mutes() {
      return useMutesStore()
    },
    optionalRelays() {
      let options = this.$store.state.optionalRelaysList.filter(relay => {
        if (this.newRelay.length && !relay.toLowerCase().includes(this.newRelay.toLowerCase())) return false
        if (this.relays[relay]) return false
        return true
      })
      return options
    },
    npubKey() {
      if (this.$store.state.keys.pub) return this.hexToBech32(this.$store.state.keys.pub, 'npub')
      return null
    },
    nsecKey() {
      if (this.$store.state.keys.priv) return this.hexToBech32(this.$store.state.keys.priv, 'nsec')
      return null
    },
    // How the user signed in — drives the "Your keys" copy. The live auth
    // state can be null after a reload (or while a bunker reconnect is in
    // flight), so fall back to the persisted method and the attached NDK
    // signer before treating it as read-only.
    authMethod() {
      if (this.$store.state.keys.priv) return 'privateKey'
      const live = getAuthManager()?.getState?.()?.authMethod
      if (live) return live
      try {
        const stored = localStorage.getItem('astral_authMethod')
        if (['nip46', 'nip07', 'cosign', 'nostrconnect'].includes(stored)) return stored
      } catch (_) { /* storage unavailable */ }
      const signerName = ndk.signer?.constructor?.name || ''
      if (signerName.includes('Nip46')) return 'nip46'
      if (signerName.includes('Nip07')) return 'nip07'
      return 'watch'
    },
    hasLnAddr() {
      return utils.isLightningAddress(this.metadata.lud06) || (utils.isLnurl(this.metadata.lud06) && this.lnurlToLnAddr(this.metadata.lud06))
    },
    isLnurl() {
      return utils.isLnurl(this.metadata.lud06)
    }
  },

  mounted() {
    if (!this.$store.state.keys.pub) this.$router.push('/')
    this.mutes.load(this.$store).then(() => {
      for (const pubkey of this.mutes.mutedPubkeys) this.$store.dispatch('useProfile', { pubkey })
    }).catch(() => {})

    this.unsubscribe = this.$store.subscribe((mutation, state) => {
      switch (mutation.type) {
        case 'addProfileToCache': {
          if (mutation.payload.pubkey !== state.keys.pub) return

          nextTick(() => {
            setTimeout(() => {
              this.cloneMetadata()
            }, 1)
          })

          break
        }
        // case 'setKeys': {
        //   nextTick(() => {
        //     setTimeout(() => {
        //       this.keysDialog = true
        //     }, 1)
        //   })
        //   break
        // }
      }
    })
    this.cloneMetadata()
    this.cloneRelays()
  },

  beforeUnmount() {
    if (this.unsubscribe) this.unsubscribe()
  },

  methods: {
    async unmute(pubkey) {
      try {
        await this.mutes.setMuted(this.$store, pubkey, false)
      } catch (e) {
        Notify.create({ message: e?.message || String(e), color: 'negative' })
      }
    },
    // Check the server answers before keeping it: one tiny translation.
    async saveTranslate() {
      this.translateError = ''
      this.translateStatus = ''
      let url
      try {
        url = normalizeServerUrl(this.translateUrl)
      } catch (e) {
        this.translateError = e.message
        return
      }
      if (!url) return this.clearTranslate()
      const previous = getTranslateSettings()
      this.translateTesting = true
      try {
        saveTranslateSettings({ url, apiKey: this.translateKey })
        const { text } = await translate('hola, buenos días')
        this.translateUrl = url
        this.translateSaved = true
        this.translateStatus = `saved. test: “hola, buenos días” → “${text}”`
      } catch (e) {
        saveTranslateSettings(previous) // keep what worked before
        this.translateError = `couldn’t reach that server: ${e?.message || e}`
      } finally {
        this.translateTesting = false
      }
    },
    clearTranslate() {
      saveTranslateSettings({ url: '' })
      this.translateUrl = ''
      this.translateKey = ''
      this.translateSaved = false
      this.translateError = ''
      this.translateStatus = 'removed.'
    },

    cloneMetadata() {
      this.metadata = Object.assign({}, this.$store.state.profilesCache[this.$store.state.keys.pub])
      // this.metadata = {name, picture, about, nip05}
      if (this.metadata.lud06) {
        let lnAddr = this.lnurlToLnAddr(this.metadata.lud06)
        if (lnAddr) this.metadata.lud06 = lnAddr
      } else if (this.metadata.lud16) {
        this.metadata.lud06 = this.metadata.lud16
      }
    },
    convertLud06() {
      if (utils.isLightningAddress(this.metadata.lud06)) this.metadata.lud06 = this.lnAddrToLnurl(this.metadata.lud06)
      else if (utils.isLnurl(this.metadata.lud06) && this.lnurlToLnAddr(this.metadata.lud06)) this.metadata.lud06 = this.lnurlToLnAddr(this.metadata.lud06)
      this.showLnAddr = !this.showLnAddr
    },
    cloneRelays() {
      // this.relays = JSON.parse(JSON.stringify(this.$store.state.relays))
      this.relays = Object.assign({},
        Object.keys(this.$store.state.relays).length ? this.$store.state.relays : this.$store.state.defaultRelays)
    },
    async setMetadata() {
      if (this.metadata.created_at) delete this.metadata.created_at
      if (this.metadata.nip05 === '') this.metadata.nip05 = undefined
      if (this.metadata.nip05) {
        try {
          if ((await nip05.queryProfile(this.metadata.nip05)).pubkey !== this.$store.state.keys.pub)
            throw new Error('Failed to verify NIP05 identifier on server.')
        } catch (error) {
          this.$q.notify({
            message: 'Failed to verify NIP05 identifier on server.',
            color: 'warning'
          })

          return
        }
      }

      if (this.metadata.lud06) {
        if (utils.isLightningAddress(this.metadata.lud06)) {
          this.metadata.lud16 = this.metadata.lud06
          this.metadata.lud06 = this.lnAddrToLnurl(this.metadata.lud16)
        } else {
          let lnAddr = this.lnurlToLnAddr(this.metadata.lud06)
          if (lnAddr) this.metadata.lud16 = lnAddr
        }
        if (!utils.isLnurl(this.metadata.lud06)) {
          this.$q.notify({
            message: 'Invalid lud06 identifier, must start with LNURL.',
            color: 'warning'
          })
          return
        }
        if (this.metadata.lud16 && !utils.isLightningAddress(this.metadata.lud16)) {
          this.$q.notify({
            message: 'Invalid lud16 identifier, must be a lightning address.',
            color: 'warning'
          })
          return
        }
      }

      if (!Object.keys(this.$store.state.relays).length) this.saveRelays()
      this.$store.dispatch('setMetadata', this.metadata)
      this.editingMetadata = false
    },
    addRelay() {
      if (this.newRelay && this.newRelay.length) this.relays[this.newRelay] = { read: true, write: true }
      this.newRelay = ''
    },
    removeRelay(url) {
      delete this.relays[url]
    },
    saveRelays() {
      if (!Object.keys(this.relays).length) {
        this.$q
        .dialog({
          title: 'no relays saved!',
          message: 'you must have at least one relay selected to save. please add a relay.',
          ok: {color: 'accent'}
        })
        .onOk(() => {
          return
        })
        return
      }
      if (this.$store.getters.canSignEventsAutomatically) this.$store.commit('saveRelays', this.relays)
      this.editingRelays = false
    },
    cancel(section) {
      if (section === 'metadata') {
        this.editingMetadata = false
        this.cloneMetadata()
        return
      }
      if (section === 'relays') {
        this.editingRelays = false
        this.cloneRelays()
        return
      }
      // if (section === 'preferences') {
      //   this.editingPreferences = false
      //   this.clonePreferences()
      //   for (let [colorName, color] of Object.entries(this.preferences.color)) this.updateColor(color, colorName)
      //   this.updateFont(this.preferences.font)
      //   return
      // }
    },
    shareRelay(url) {
      this.hasJustSharedRelay = true
      this.$store.dispatch('recommendRelay', url)
      setTimeout(() => {
        this.hasJustSharedRelay = false
      }, 5000)
    },
    async logout() {
      this.$q
        .dialog({
          title: 'logout?',
          message: 'this will not delete your local nostr database but will allow you to login as another user. continue?',
          cancel: {color: 'accent'},
          ok: {color: 'accent'}
        })
        .onOk(async () => {
          // Lets a phone signer drop this site from its list before we forget it.
          await getAuthManager()?.logout().catch(() => {})
          LocalStorage.clear()
          window.location.reload()
        })
    },
    async hardReset() {
      this.$q
        .dialog({
          title: 'delete all data?',
          message: 'do you really want to delete all data from this device?',
          cancel: {color: 'accent'},
          ok: {color: 'accent'}
        })
        .onOk(async () => {
          LocalStorage.clear()
          window.location.reload()
        })
    },
    updateFont(font) {
      // this.preferences.font = font
      this.$emit('update-font', font)
    },
  }
}
</script>

<style lang='css' scoped>
.section {
  padding: .5rem;
}
</style>
