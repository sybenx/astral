<template>
  <q-btn-group class='no-padding' flat>
  <q-btn
    aria-label='tip with bitcoin lightning network'
    v-if="lnString && this.$store.state.config.preferences.lightningTips.enabled"
    icon="bolt"
    class='button-lightning'
    :class='(oneClick ? "q-pr-none q-pl-sm" : "")'
    @click.stop='handleLightningTipClick'
    align="left"
    :size='size'
    unelevated
    :ripple='false'
    dense
    :disable='loading'
    style='padding: 0;'
  >
    <q-tooltip v-if='!loading'>
      tip with bitcoin lightning network
    </q-tooltip>
    <q-dialog v-model="showLightningCard">
      <BaseLightningCard :ln-string='lnString' :pubkey='pubkey' style='padding: 1.5rem;'/>
    </q-dialog>
  </q-btn>
  <q-btn v-if='oneClick' aria-label='choose a tip amount' icon='arrow_drop_down' class='no-padding' dense unelevated :size='size' @click.stop="showLightningCard=!showLightningCard">
  </q-btn>
  </q-btn-group>
</template>

<script>
import { defineComponent, defineAsyncComponent } from 'vue'
import helpersMixin from '../utils/mixin'
// the card (amount, wallet picker, bolt11 decoder) loads when someone taps ⚡
const BaseLightningCard = defineAsyncComponent(() => import('components/BaseLightningCard.vue'))
import {Notify} from 'quasar'

export default defineComponent({
  name: 'BaseButtonLightning',
  mixins: [helpersMixin],
  components: {
    BaseLightningCard
  },

  data() {
    return {
      showLightningCard: false,
      oneClick: this.$store.state.config.preferences.lightningTips.oneClick.enabled,
      amount: this.$store.state.config.preferences.lightningTips.oneClick.amount,
      lnString: this.$store.getters.profileLud06(this.pubkey),
      loading: false,
    }
  },

  props: {
    pubkey: {type: String, required: true},
    size: {
      type: String,
      required: false,
      default: 'sm',
    },
    // verbose: {
    //   type: Boolean,
    //   default: false
    // }
  },

  methods: {
    // one click tips through a webln browser extension; otherwise the amount
    // and wallet picker opens
    handleLightningTipClick() {
      if (!window.webln || !this.$store.state.config.preferences.lightningTips.oneClick.enabled) this.showLightningCard = !this.showLightningCard
      else this.sendTip()
    },
    async sendTip() {
      if (!window.webln) return
      this.loading = true
      try {
        const invoice = await this.getInvoice(this.lnString, this.amount)
        if (!invoice || !invoice.toLowerCase().startsWith('lnbc')) {
          Notify.create({
            message: `invoice couldn't be fetched for ${this.$store.getters.displayName(this.pubkey)}, please use a different pay method`,
            color: 'negative'
          })
          return
        }

        await window.webln.enable()
        await window.webln.sendPayment(invoice)
        Notify.create({
          message: `${this.amount} sats sent to ${this.$store.getters.displayName(this.pubkey)}`
        })
      } catch (e) {
        Notify.create({ message: `one click tip unsuccessful: ${e?.message || e}`, color: 'negative' })
      } finally {
        this.loading = false
      }
    }
  }
})
</script>


<style>
.button-lightning {
  opacity: .7;
  transition: all .3s ease-in-out;
}
.button-lightning:hover {
  opacity: 1;
}
</style>
