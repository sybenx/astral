<template>
  <div v-if='visible' class='protect-banner flex row items-center'>
    <q-icon name='shield' size='sm' class='flex-none'/>
    <span class='col'>Your account only lives in this browser. If you clear it or lose this device, the account is gone.</span>
    <div class='flex row no-wrap' style='gap: .3rem;'>
      <q-btn unelevated dense no-caps color='primary' text-color='dark' class='q-px-sm' label='protect it' @click='open = true'/>
      <q-btn flat dense no-caps label='later' @click='later'/>
    </div>

    <q-dialog v-model='open'>
      <q-card class='protect-dialog'>
        <q-card-section class='flex column' style='gap: .6rem;'>
          <span class='text-h6'>protect your account</span>
          <!-- Placeholder: moving the key to a phone (QRST Signer or Cosign) goes here. -->
          <p>Soon you’ll be able to move your account to your phone with Cosign or QRST Signer, so it’s safe even if this browser is lost.</p>
          <p>Until then, save a backup: the private key in settings is your account. Keep it somewhere safe, like a password manager, and never share it.</p>
        </q-card-section>
        <q-card-actions align='right'>
          <q-btn flat no-caps label='close' v-close-popup/>
          <q-btn unelevated no-caps color='primary' text-color='dark' label='back it up in settings' @click='toSettings'/>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { countVisit, shouldSuggestProtecting, snoozeProtecting } from '../utils/accountCare'

// Shown to accounts whose key lives only in this browser (keys.priv), from the
// second visit or third note on. "later" snoozes it; it never goes away for good.
export default defineComponent({
  name: 'TheProtectAccountBanner',

  data() {
    return {
      snoozed: false,
      due: false,
      open: false
    }
  },

  computed: {
    visible() {
      return !!this.$store.state.keys.priv && !this.snoozed && this.due
    }
  },

  created() {
    if (this.$store.state.keys.priv) countVisit()
    this.due = shouldSuggestProtecting()
  },

  methods: {
    later() {
      snoozeProtecting()
      this.snoozed = true
    },

    toSettings() {
      this.open = false
      this.$router.push('/settings')
    }
  }
})
</script>

<style lang='css' scoped>
.protect-banner {
  gap: .6rem;
  margin: .5rem;
  padding: .6rem .8rem;
  border: 1px solid var(--q-accent);
  border-radius: .5rem;
  font-size: .85rem;
}
.protect-dialog {
  background: var(--q-background);
  max-width: 26rem;
}
</style>
