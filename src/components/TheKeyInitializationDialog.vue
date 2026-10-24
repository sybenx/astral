<template>
  <!-- <q-dialog persistent> -->
  <!-- <div v-if="showKeyInitialization"> -->
    <q-card class='welcome-card relative-position full-width' :class='{ "welcome-card--full": $q.screen.lt.sm }'>
      <q-btn icon='close' size='md' flat round class='close-button absolute-top-right z-top' aria-label='close and look around' @click='$emit("look-around")'/>
      <h1 class="text-h6 q-pr-xl">welcome to astral</h1>
      <q-expansion-item
        expand-icon='help'
        expanded-icon='expand_less'
        class="intro no-padding full-width items-center"
        header-class='items-center q-px-sm'
      >
        <template #header>
          <span class='full-width'>new to Nostr? learn more</span>
        </template>
        <BaseInformation/>
        <span style='padding: .2rem 0 0 .2rem;'>after you sign in, you can find this again in the
        <strong>faq</strong> at the bottom of settings.</span>
      </q-expansion-item>

      <div class='sign-in q-mt-md flex column items-center'>
        <!-- One button: the browser extension if there is one, otherwise a code for the phone. -->
        <q-btn
          v-if='stage === "idle"'
          unelevated
          no-caps
          color='primary'
          text-color='dark'
          class='sign-in-button full-width'
          label='sign in'
          @click='signIn'
        />
        <q-btn
          v-if='stage === "idle"'
          flat
          no-caps
          class='tap-target full-width'
          label='new here? create an account'
          @click='startCreate'
        />

        <q-form v-else-if='stage === "create"' class='create-account full-width flex column' @submit.prevent='createAccount'>
          <span class='text-subtitle1'>create your account</span>
          <div class='flex row no-wrap items-center' style='gap: .8rem;'>
            <label class='avatar-pick flex flex-center' for='new-account-picture' title='add a picture (optional)'>
              <img v-if='picturePreview' :src='picturePreview' alt='your picture'/>
              <q-icon v-else name='add_a_photo' size='sm'/>
            </label>
            <input id='new-account-picture' type='file' accept='image/*' class='hidden' @change='pickPicture'/>
            <q-input
              v-model='newName'
              id='new-account-name'
              class='col'
              dense
              outlined
              autofocus
              maxlength='50'
              label='your name'
            />
          </div>
          <span class='hint text-left'>add a picture if you like. you can change both later in settings.</span>
          <q-btn
            type='submit'
            unelevated
            no-caps
            color='primary'
            text-color='dark'
            class='sign-in-button full-width'
            label='create account'
            :loading='creating'
            :disable='!newName.trim()'
          />
          <span v-if='creating' class='hint'>{{ status }}</span>
        </q-form>

        <template v-else-if='stage === "extension"'>
          <div class='flex row items-center' style='gap: .5rem;'>
            <q-spinner-dots color='primary' size='sm'/>
            <span>check your browser extension…</span>
          </div>
        </template>

        <template v-else-if='stage === "phone"'>
          <span v-if='!code' class='flex row items-center' style='gap: .5rem;'>
            <q-spinner-dots color='primary' size='sm'/>{{ lowerFirst(status) || 'getting a code ready…' }}
          </span>
          <template v-else-if='onAndroid && !showCode'>
            <!-- A real link the user taps, so Android hands it to Cosign (App Links). -->
            <a :href='code' class='sign-in-button sign-in-link full-width'>open your signer app</a>
            <span class='hint'>opens Cosign or your signer app. approve there, then come back here.</span>
          </template>
          <template v-else>
            <div class='qr-frame bg-white'>
              <BaseQr :key='code' :code='code'/>
            </div>
            <span class='hint'>{{ lowerFirst(status) }}</span>
            <span class='hint'>Amber and other signer apps can scan it too.</span>
          </template>
        </template>

        <template v-else-if='stage === "confirm"'>
          <span class='text-center'>{{ confirmText }}</span>
          <div class='flex row no-wrap full-width' style='gap: .4rem;'>
            <q-btn unelevated no-caps color='primary' text-color='dark' class='col tap-target' label='sign in' @click='confirmAnswer(true)'/>
            <q-btn outline no-caps color='primary' class='col tap-target' label='cancel' @click='confirmAnswer(false)'/>
          </div>
        </template>

        <template v-else-if='stage === "signing-in"'>
          <div class='flex row items-center' style='gap: .5rem;'>
            <q-spinner-dots color='primary' size='sm'/>
            <span>{{ lowerFirst(status) || 'signing in…' }}</span>
          </div>
        </template>

        <span v-if='signerError' class='text-negative text-center' style='font-size: .85rem;'>{{ lowerFirst(signerError) }}</span>

        <div class='sign-in-links flex row wrap justify-center'>
          <q-btn
            v-if='stage === "phone" && code && onAndroid'
            flat no-caps
            class='tap-target'
            :label='showCode ? "open the app instead" : "show a code instead"'
            @click='showCode = !showCode'
          />
          <q-btn
            v-if='stage === "extension" || (stage === "idle" && signerError && hasExtension)'
            flat no-caps
            class='tap-target'
            label='use your phone instead'
            @click='startPhone'
          />
          <q-btn v-if='stage === "phone" && code' flat no-caps class='tap-target' icon='content_copy' label='copy link' @click='copyCode'/>
          <q-btn v-if='stage === "create" && !creating' flat no-caps class='tap-target' label='I already have an account' @click='stage = "idle"'/>
          <q-btn v-else-if='stage !== "idle" && stage !== "create"' flat no-caps class='tap-target' label='cancel' @click='cancelSignIn'/>
        </div>
      </div>

      <q-expansion-item
        class='q-mt-md'
        label='other ways to sign in'
        header-class='other-ways text-secondary q-px-sm'
        @before-show='checkExtension'
      >
      <div class='q-mt-sm flex column' style='gap: .4rem;'>
        <h2 class="text-subtitle2 q-pr-md">paste a bunker:// link</h2>
        <div class='flex row no-wrap items-center' style='gap: .4rem;'>
          <q-input
            v-model='bunkerString'
            dense
            outlined
            class='col'
            label='bunker:// connection string'
          />
          <q-btn
            unelevated
            no-caps
            color='positive'
            class='tap-target'
            label='connect'
            :loading='bunkerConnecting'
            :disable='!bunkerString'
            @click='loginWithBunker'
          />
        </div>
        <span class='text-secondary' style='font-size: .75rem;'>from Amber, Clave, nsec.app, or another remote signer</span>
      </div>

      <h2 class="text-subtitle2 q-pr-md">or enter a key directly</h2>
      <q-form @submit="proceed">
        <q-card-section class="key-entry no-padding flex column">
          <q-btn-group spread unelevated>
            <q-btn
              no-caps
              class="tap-target"
              color="primary"
              label="public key"
              :outline="!watchOnly"
              :text-color="!watchOnly ? '' : 'dark'"
              value="true"
              @click="watchOnly = true"
              :disable='isBech32Sec'
            />
            <q-btn
              no-caps
              class="tap-target"
              color="primary"
              label="private key"
              :outline="watchOnly"
              :text-color="watchOnly ? '' : 'dark'"
              value="false"
              @click="watchOnly = false"
              :disable='isBech32Pub'
            />
          </q-btn-group>
          <q-input
            v-model="key"
            ref="keyInput"
            outlined
            :label="watchOnly ? 'enter public key' : 'enter private key'"
            dense
          />
          <!-- Below the field rather than in its bottom slot, which fits only one line. -->
          <span class="key-hint">
            <template v-if="!key && watchOnly">
              with a public key, you will need to enter your private key
              each time you post (by hand or with a Nostr browser extension)
            </template>
            <template v-else-if="!key">
              with a private key, astral signs with it automatically
              each time you post
            </template>
            <template v-else-if="!isKeyValid">not a valid key</template>
            <template v-else>key is valid</template>
          </span>
          <!-- Stacked on phones; side by side once there's room. -->
          <div v-if="!isKeyValid" class="key-actions flex" :class="$q.screen.lt.sm ? 'column' : 'row no-wrap'">
            <q-btn
              outline
              no-caps
              color="primary"
              class="tap-target col"
              label="generate keys"
              @click="generate"
            />
            <q-btn
              v-if="hasExtension"
              outline
              no-caps
              color="primary"
              class="tap-target col"
              label="use public key from extension"
              @click="getFromExtension"
            />
          </div>
          <q-btn
            type="submit"
            unelevated
            no-caps
            color="positive"
            class="tap-target full-width"
            label="sign in with this key"
            icon-right="login"
            style='color: var(--q-background) !important;'
            :disable="!isKeyValid"
          />
        </q-card-section>
      <!-- <div v-if='isBech32Key(key)'>
      {{ hexKey }}
      </div> -->
      </q-form>
      <q-expansion-item
        v-if='isKeyValid'
        dense
        dense-toggle
        default-opened
        id='bootstrap-relays'
      >
        <template #header>
          <div class='full-width flex row no-wrap items-center'>
            <h2 class="text-subtitle2 q-pr-md">bootstrap relays (optional)</h2>
            <q-icon name='info'>
              <q-tooltip>
              astral asks the selected relays below for your profile, follows, and relay list.
              include the relays you publish to, or astral may not find your data.
              </q-tooltip>
            </q-icon>
          </div>
        </template>
        <div class='flex row justify-between no-wrap items-end' >
          <span>selected relays</span>
          <div class='flex row items-end' id='new-relay-input'>
            <q-input v-model='newRelay' placeholder='add a relay…' input-style='padding: 0; width: 10rem;' @keypress.enter='addNewRelay' dense borderless/>
            <q-btn icon='add' color='positive' size='sm' flat dense @click.stop='addNewRelay'/>
          </div>
        </div>
        <BaseSelectMultiple>
          <template #selected>
            <pre class='relay-list' style='border: 1px solid var(--q-primary);'>
              <li
                v-for='(relay, index) in Object.keys(selectedRelays)'
                :key='index + "-" + relay'
                class='relay-item'
                @click.stop='delete selectedRelays[relay]'
              >
                <div class='flex row justify-between no-wrap'>
                  <span style='overflow: auto;'>{{relay}}</span>
                  <q-icon name='remove' size='xs' color='negative'/>
                </div>
              </li>
            </pre>
          </template>
          <template #options>
            <div style='max-height: 6.75rem;'>
            <pre class='relay-list' >
              <li
                v-for='(relay, index) in optionalRelays'
                :key='index + "-" + relay'
                class='relay-item'
                @click.stop='selectedRelays[relay]={read: true, write:false}'
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
      </q-expansion-item>
      </q-expansion-item>
      <div style='min-height: 1rem;'/>
    </q-card>
  <!-- </div> -->
  <!-- </q-dialog> -->
</template>

<script>
import { defineComponent, markRaw } from 'vue'
import helpersMixin from '../utils/mixin'
import { generatePrivateKey, getPublicKey, nip06 } from '../utils/ntcompat'
import { uploadImage } from '../nostr/mediaUpload'
import { markAccountCreated } from '../utils/accountCare'
import { getAuthManager } from '../nostr/authManager'
import { copyToClipboard, Notify } from 'quasar'
import { lowerFirst } from '../utils/helpers'
// import { decode } from 'bech32-buffer'
import BaseSelectMultiple from 'components/BaseSelectMultiple.vue'
import BaseInformation from 'components/BaseInformation.vue'
import BaseQr from 'components/BaseQr.vue'

export default defineComponent({
  name: 'TheKeyInitializationDialog',
  mixins: [helpersMixin],
  emits: ['look-around'],

  components: {
    BaseSelectMultiple,
    BaseInformation,
    BaseQr,
  },

  setup() {
    return {
      focusKeyInput() {
        this.$refs.keyInput.focus()
      },
    }
  },

  data() {
    return {
      watchOnly: false,
      key: null,
      selectedRelays: this.$store.state.defaultRelays,
      newRelay: '',
      bunkerString: '',
      bunkerConnecting: false,
      signerError: '',
      // sign-in: idle → extension | phone → (confirm) → signing-in, or idle → create
      stage: 'idle',
      newName: '',
      pictureFile: null,
      picturePreview: '',
      creating: false,
      code: '',
      status: '',
      showCode: false,
      confirmText: '',
      confirmFn: null,
      pairing: null,
      authUnsub: null,
      finishedLogin: false,
      // window.nostr isn't reactive; re-read when "other ways" opens, since
      // some extensions inject it after the page loads.
      hasExtension: !!window.nostr,
    }
  },

  computed: {
    onAndroid() {
      return /Android/i.test(navigator.userAgent)
    },

    icon() {
      return document.getElementById('icon').href
    },

    // showKeyInitialization() {
    //   if (['profile', 'event', 'hashtag', 'feed'].includes(this.$route.name)) return false
    //   return true
    // },

    isKeyKey() {
      if (this.isKey(this.hexKey)) return true
      return false
    },

    isKeyValid() {
      return this.isKeyKey || !!this.mnemonic
    },

    // The pasted seed words, normalized, if they're a valid mnemonic.
    mnemonic() {
      const words = this.key?.trim().toLowerCase().split(/\s+/).join(' ')
      if (!words || !words.includes(' ')) return null
      try {
        return nip06.validateWords(words) ? words : null
      } catch {
        return null
      }
    },

    isKeyInvalid() {
      return !this.isKeyValid
    },

    hexKey() {
      // npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s
      // nsec1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzs46ahj9
      // 32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245
      if (this.isBech32Key(this.key)) {
        return this.bech32ToHex(this.key)
      }
      return this.key?.trim().toLowerCase()
    },

    isBech32Pub() {
      if (this.isBech32Key(this.key)) {
        return this.key.trim().toLowerCase().startsWith('npub')
      }
      return false
    },

    isBech32Sec() {
      if (this.isBech32Key(this.key)) {
        return this.key.trim().toLowerCase().startsWith('nsec')
      }
      return false
    },

    optionalRelays() {
      let options = this.$store.state.optionalRelaysList.filter(relay => {
        if (this.newRelay.length && !relay.toLowerCase().includes(this.newRelay.toLowerCase())) return false
        if (this.selectedRelays[relay]) return false
        return true
      })
      return options
    }
  },

  async created() {
    // Every signer login lands here through the auth state, however it started.
    const auth = getAuthManager()
    if (auth) {
      this.authUnsub = auth.subscribe((state) => {
        if (state.isAuthenticated && state.publicKey) this.handleAuthenticated(state.publicKey)
        else if (state.error) this.signerError = state.error
      })
    }
  },

  beforeUnmount() {
    if (this.authUnsub) this.authUnsub()
    if (this.pairing) this.pairing.cancel()
    if (this.picturePreview) URL.revokeObjectURL(this.picturePreview)
  },

  methods: {
    lowerFirst,

    checkExtension() {
      this.hasExtension = !!window.nostr
    },

    async getFromExtension() {
      if (!window.nostr) {
        this.$q.notify({ message: 'no browser extension found. install Alby or nos2x.', color: 'warning' })
        return
      }
      try {
        this.key = await window.nostr.getPublicKey()
        this.watchOnly = true
        this.focusKeyInput()
      } catch (err) {
        this.$q.notify({
          message: `Failed to get a public key from a Nostr extension: ${err}`,
          color: 'warning',
        })
      }
    },

    generate() {
      this.key = generatePrivateKey()
      this.watchOnly = false
      this.focusKeyInput()
    },

    proceed() {
      let key = this.hexKey

      var keys = {}
      // Seed words always mean a private key. (Without this branch keys stayed
      // empty and setKeys made a brand-new account.)
      if (this.mnemonic) {
        keys.mnemonic = this.mnemonic
      } else if (this.isKey(key)) {
        if (this.watchOnly) keys.pub = key
        else keys.priv = key
      } else {
        // Empty keys would make setKeys generate a new account, so stop here.
        console.warn('Proceed called with invalid key', key)
        return
      }

      this.$store.commit('setDefaultRelays', this.selectedRelays)
      this.$store.dispatch('initKeys', keys)
      this.$store.dispatch('launch')
      this.initializeKeys = false
      this.$router.push('/')
    },

    addNewRelay() {
      if (this.newRelay && this.newRelay.length) this.selectedRelays[this.newRelay] = {read: true, write: false}
      this.newRelay = ''
    },

    // Finish a remote-signer login: store the pubkey (no private key — signing
    // is delegated to the active NDK signer), then launch like proceed() does.
    finishRemoteLogin(pub) {
      this.$store.commit('setDefaultRelays', this.selectedRelays)
      this.$store.dispatch('initKeys', { pub })
      this.$store.dispatch('launch')
      this.$router.push('/')
    },

    // Single funnel for every signer login (extension / bunker / nostrconnect),
    // fired by the auth-state subscription. Guarded so it runs once.
    handleAuthenticated(pub) {
      if (this.finishedLogin || !pub) return
      this.finishedLogin = true
      this.finishRemoteLogin(pub)
    },

    // The one Sign in button: a browser extension if the page has one (asked
    // only now, on the tap), otherwise a code for the phone.
    signIn() {
      this.signerError = ''
      this.checkExtension()
      if (window.nostr) this.loginWithExtension()
      else this.startPhone()
    },

    async loginWithExtension() {
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      this.stage = 'extension'
      try {
        // No timeout: the extension may be showing its own prompt.
        await auth.authenticateWithNIP07() // subscription → handleAuthenticated
      } catch (err) {
        if (this.stage !== 'extension') return // the user switched to the phone meanwhile
        this.stage = 'idle'
        this.signerError = /not now|denied|reject|cancel|declin/i.test(err?.message || '')
          ? 'not signed in. tap sign in to try again, or use your phone instead.'
          : (err?.message || 'could not connect to your browser extension')
      }
    },

    // Show a code: Cosign answers it with a ticket; any other signer app uses the
    // nostrconnect half. On Android the code is a link that opens the app.
    startPhone() {
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      if (this.pairing) this.pairing.cancel()
      this.signerError = ''
      this.stage = 'phone'
      this.code = ''
      this.status = ''
      this.showCode = false
      // markRaw: kept as is, so `this.pairing === pairing` tells a live pairing from a replaced one.
      const pairing = markRaw(auth.startSignIn({
        code: (uri) => { this.code = uri },
        status: (text) => { this.status = text },
        confirm: (rendering, yes, no) => {
          this.confirmText = rendering
          this.confirmFn = (ok) => (ok ? yes() : no())
          this.stage = 'confirm'
        }
      }))
      this.pairing = pairing
      pairing.done.then(
        () => { this.stage = 'signing-in' }, // subscription → handleAuthenticated
        (err) => {
          if (this.pairing !== pairing) return // cancelled or replaced
          this.pairing = null
          this.stage = 'idle'
          this.signerError = err?.message || 'not signed in'
        }
      )
    },

    confirmAnswer(ok) {
      const answer = this.confirmFn
      this.confirmFn = null
      this.stage = ok ? 'signing-in' : 'idle'
      if (answer) answer(ok)
    },

    cancelSignIn() {
      if (this.pairing) this.pairing.cancel()
      this.pairing = null
      this.stage = 'idle'
      this.code = ''
      this.status = ''
    },

    startCreate() {
      this.signerError = ''
      this.stage = 'create'
    },

    pickPicture(e) {
      const file = e.target.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        this.signerError = 'that file isn’t a picture'
        return
      }
      if (this.picturePreview) URL.revokeObjectURL(this.picturePreview)
      this.pictureFile = file
      this.picturePreview = URL.createObjectURL(file)
    },

    // Make an account here: a new key in this browser, then the profile. The
    // picture is uploaded first, signed with the new key, so the dialog is still
    // open to show progress; the account goes live once the profile is ready.
    async createAccount() {
      const name = this.newName.trim()
      if (!name || this.creating) return
      this.signerError = ''
      this.creating = true
      const priv = generatePrivateKey()
      const pub = getPublicKey(priv)
      const metadata = { name, display_name: name }
      try {
        if (this.pictureFile) {
          this.status = 'uploading your picture…'
          try {
            metadata.picture = await uploadImage({ state: { keys: { priv, pub } } }, this.pictureFile)
          } catch (err) {
            Notify.create({ message: 'couldn’t upload your picture. you can add one later in settings.', color: 'warning' })
          }
        }
        this.status = 'setting up your account…'
        this.$store.commit('setDefaultRelays', this.selectedRelays)
        this.$store.dispatch('initKeys', { priv })
        markAccountCreated()
        await this.$store.dispatch('setMetadata', metadata)
        this.$store.dispatch('launch')
        this.$router.push('/')
      } catch (err) {
        this.signerError = err?.message || 'couldn’t create your account'
      } finally {
        this.creating = false
      }
    },

    copyCode() {
      if (!this.code) return
      copyToClipboard(this.code).then(() => Notify.create({ message: 'link copied' }))
    },

    async loginWithBunker() {
      this.signerError = ''
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      this.bunkerConnecting = true
      try {
        await auth.authenticateWithNIP46(this.bunkerString.trim())
      } catch (err) {
        this.signerError = err?.message || 'could not connect to the remote signer'
      } finally {
        this.bunkerConnecting = false
      }
    },

  },
})
</script>

<style lang='css' scoped>
.q-card {
  background: var(--q-background);
  padding: 1rem;
}
/* Full screen on phones: room to breathe, and clear of the notch and home bar. */
.welcome-card--full {
  padding: max(1rem, env(safe-area-inset-top)) 1.25rem max(1.5rem, env(safe-area-inset-bottom));
}
.welcome-card--full h1 {
  margin-top: .5rem;
}
.close-button {
  width: 48px;
  height: 48px;
}
.welcome-card--full .close-button {
  top: max(.25rem, env(safe-area-inset-top));
  right: .25rem;
}
.sign-in {
  gap: .6rem;
}
.sign-in-button {
  font-size: 1rem;
  padding: .5rem 0;
  min-height: 48px;
}
/* Every small action gets a finger-sized target. */
.tap-target {
  min-height: 44px;
}
.sign-in-links {
  gap: .25rem .5rem;
}
.key-entry,
.key-actions {
  gap: .5rem;
}
.key-hint {
  font-size: .75rem;
  color: var(--q-secondary);
  margin-top: -.25rem;
}
.sign-in-link {
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border-radius: 4px;
  background: var(--q-primary);
  color: var(--q-dark);
}
.qr-frame {
  width: 15rem;
  max-width: 100%;
  padding: .5rem;
  border-radius: .4rem;
}
.create-account {
  gap: .6rem;
}
.avatar-pick {
  width: 3rem;
  height: 3rem;
  flex: none;
  border-radius: 50%;
  border: 1px dashed var(--q-accent);
  cursor: pointer;
  overflow: hidden;
}
.avatar-pick img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hint {
  font-size: .8rem;
  color: var(--q-secondary);
  text-align: center;
}
</style>

<style lang='css'>
.relay-list {
  column-width: 15rem;
  column-gap: .5rem;
  width: 100%;
  min-height: 1px;
  font-size: .8rem;
  white-space: nowrap;
  padding: 0 .5rem;
  border-radius: .5rem;
  overflow-y: auto;
  overflow-x: hidden;
}
.relay-item {
  overflow: auto;
}
#new-relay-input {
   background: rgba(0, 0, 0, 0.05);
   border-radius: .3rem;
   padding: 0 0 0 .5rem;
}
.body--dark #new-relay-input {
   background: rgba(255, 255, 255, 0.08);
}
#new-relay-input .q-field--dense .q-field__control {
  height: 1.4rem !important;
}
</style>
