<template>
  <div v-if='visible' class='protect-banner flex row items-center'>
    <q-icon name='shield' size='sm' class='flex-none'/>
    <span class='col'>Your account only lives in this browser. If you clear it or lose this device, the account is gone.</span>
    <div class='flex row no-wrap' style='gap: .3rem;'>
      <q-btn unelevated dense no-caps color='primary' text-color='dark' class='q-px-sm' label='protect it' @click='open = true'/>
      <q-btn flat dense no-caps label='later' @click='later'/>
    </div>
  </div>

  <q-dialog v-model='open' @hide='onHide'>
    <q-card class='protect-dialog'>
      <q-card-section class='flex column' style='gap: .7rem;'>
        <span class='text-h6'>protect your account</span>

        <template v-if='stage === "intro"'>
          <p>Move your account to your phone with Cosign. Your phone and Cosign’s servers hold it together, so it stays yours even if this browser is lost, and this browser no longer holds it.</p>
          <p class='hint'>You’ll need Cosign on your phone. <a href='https://cosign.aaro.cc/' target='_blank' rel='noopener noreferrer'>Get Cosign</a></p>
        </template>

        <template v-else-if='stage === "moving"'>
          <span v-if='!code' class='flex row items-center' style='gap: .5rem;'>
            <q-spinner-dots color='primary' size='sm'/>{{ status }}
          </span>
          <template v-else-if='!digitsAsked'>
            <a v-if='onAndroid && openLink && !showCode' :href='openLink' class='open-link'>open Cosign</a>
            <div v-else class='qr-frame bg-white self-center'>
              <BaseQr :key='code' :code='code'/>
            </div>
            <span class='hint text-center'>{{ status }}</span>
            <q-btn
              v-if='onAndroid && openLink'
              flat dense no-caps size='sm' class='self-center'
              :label='showCode ? "open the app instead" : "show a code instead"'
              @click='showCode = !showCode'
            />
          </template>
          <q-form v-else class='flex column' style='gap: .5rem;' @submit.prevent='sendDigits'>
            <span>Type the five digits Cosign shows on your phone.</span>
            <q-input
              v-model='digits'
              id='protect-digits'
              dense
              outlined
              autofocus
              inputmode='numeric'
              maxlength='5'
              mask='#####'
              class='digits'
              :hint='triesLeft < 3 ? `${triesLeft} tries left` : ""'
            />
            <q-btn type='submit' unelevated color='primary' text-color='dark' label='move it' :disable='digits.length !== 5'/>
          </q-form>
        </template>

        <template v-else-if='stage === "done"'>
          <p>Your account is on your phone now. This browser no longer holds it; Astral signs through Cosign from here on.</p>
        </template>

        <span v-if='error' class='text-negative'>{{ error }}</span>
      </q-card-section>

      <q-card-actions align='right'>
        <template v-if='stage === "intro"'>
          <q-btn flat no-caps label='back it up instead' @click='toSettings'/>
          <q-btn unelevated no-caps color='primary' text-color='dark' :label='error ? "try again" : "move to my phone"' @click='startMove'/>
        </template>
        <q-btn v-else-if='stage === "moving"' flat no-caps label='cancel' @click='cancelMove'/>
        <q-btn v-else flat no-caps label='done' v-close-popup/>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import { defineComponent, markRaw } from 'vue'
import { getAuthManager } from '../nostr/authManager'
import { countVisit, shouldSuggestProtecting, snoozeProtecting } from '../utils/accountCare'
import BaseQr from 'components/BaseQr.vue'

// Shown to accounts whose key lives only in this browser (keys.priv), from the
// second visit or third note on. "later" snoozes it; it never goes away for good.
// "protect it" moves the key into Cosign: the phone and Cosign's servers hold it
// together, and Astral signs through them afterwards.
export default defineComponent({
  name: 'TheProtectAccountBanner',
  components: { BaseQr },

  data() {
    return {
      snoozed: false,
      due: false,
      open: false,
      // intro → moving → done; a failure goes back to intro with the error shown
      stage: 'intro',
      status: '',
      code: '',
      openLink: '',
      showCode: false,
      digitsAsked: false,
      digits: '',
      triesLeft: 3,
      submitDigits: null,
      move: null,
      error: ''
    }
  },

  computed: {
    visible() {
      return !!this.$store.state.keys.priv && !this.snoozed && this.due
    },

    onAndroid() {
      return /Android/i.test(navigator.userAgent)
    }
  },

  created() {
    if (this.$store.state.keys.priv) countVisit()
    this.due = shouldSuggestProtecting()
  },

  beforeUnmount() {
    if (this.move) this.move.cancel()
  },

  methods: {
    later() {
      snoozeProtecting()
      this.snoozed = true
    },

    toSettings() {
      this.open = false
      this.$router.push('/settings')
    },

    startMove() {
      const auth = getAuthManager()
      const { priv, pub } = this.$store.state.keys
      if (!auth || !priv) return
      Object.assign(this, { stage: 'moving', status: 'getting ready…', code: '', openLink: '', showCode: false, digitsAsked: false, digits: '', error: '' })
      // markRaw: kept as is, so `this.move === move` tells a live move from a cancelled one.
      const move = markRaw(auth.moveToPhone(priv, pub, {
        status: (text) => { this.status = text },
        code: (uri) => { this.code = uri },
        open: (link) => { this.openLink = link },
        enterCode: (left, submit) => {
          this.triesLeft = left
          this.submitDigits = submit
          this.digits = ''
          this.digitsAsked = true
        }
      }))
      this.move = move
      move.done.then(
        (pub) => {
          if (this.move !== move) return
          this.move = null
          // Only now, with Cosign signing as this account, forget the key here.
          this.$store.commit('setKeys', { pub })
          this.stage = 'done'
        },
        (err) => {
          if (this.move !== move) return // cancelled
          this.move = null
          this.stage = 'intro'
          this.error = err?.message === 'cancelled' ? '' : `${err?.message || 'That didn’t work.'} Your account wasn’t changed.`
        }
      )
    },

    sendDigits() {
      if (this.digits.length !== 5 || !this.submitDigits) return
      const submit = this.submitDigits
      this.submitDigits = null
      this.digitsAsked = false
      this.status = 'checking…'
      submit(this.digits)
    },

    cancelMove() {
      if (this.move) this.move.cancel()
      this.move = null
      this.stage = 'intro'
    },

    onHide() {
      if (this.stage === 'moving') this.cancelMove()
      if (this.stage === 'done') this.stage = 'intro'
    }
  }
})
</script>

<style lang='css' scoped>
/* A card over the bottom of the page, clear of the floating page buttons at the top
   and the bottom menu on phones; it doesn't push the feed around. */
.protect-banner {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
  transform: translateX(-50%);
  z-index: 2000;
  width: min(36rem, calc(100vw - 2rem));
  gap: .6rem;
  padding: .6rem .8rem;
  border: 1px solid var(--q-accent);
  border-radius: .5rem;
  background: var(--q-background);
  box-shadow: 0 .3rem 1.2rem rgba(0, 0, 0, .5);
  font-size: .85rem;
}
@media (max-width: 599px) {
  .protect-banner {
    bottom: calc(env(safe-area-inset-bottom, 0px) + 4.5rem);
  }
}
.protect-dialog {
  background: var(--q-background);
  width: 26rem;
  max-width: 100%;
}
.protect-dialog p {
  margin: 0;
}
.hint {
  font-size: .8rem;
  color: var(--q-secondary);
}
.hint a {
  color: var(--q-primary);
}
.qr-frame {
  width: 15rem;
  max-width: 100%;
  padding: .5rem;
  border-radius: .4rem;
}
.open-link {
  display: block;
  padding: .6rem 0;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: .05em;
  text-decoration: none;
  border-radius: 4px;
  background: var(--q-primary);
  color: var(--q-dark);
}
.digits :deep(input) {
  font-size: 1.4rem;
  letter-spacing: .4em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
