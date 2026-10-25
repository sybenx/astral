<template>
  <div :class='(bordered ? "bordered-avatar" : "") + (hoverEffect ? " hovered-avatar" : "")'>
    <q-avatar :rounded='!round' class='relative-position' :size='size' @click.stop="toProfile(pubkey)">
      <img :src='src' alt='' decoding='async' class='avatar-img' @error='onError'/>
      <div :class='alignRight ? "icon-right" : "icon-left"' class='q-pt-xs'>
        <BaseButtonNIP05
          v-if='showVerified'
          :pubkey='pubkey'
          button-size='xs'
        />
      </div>
    </q-avatar>
  </div>
</template>

<script>
import helpersMixin from '../utils/mixin'
import BaseButtonNIP05 from 'components/BaseButtonNIP05.vue'
import { identiconFor, loadPicture, pictureState, markImageFailed } from '../utils/avatar'

export default {
  mixins: [helpersMixin],
  components: {
    BaseButtonNIP05,
  },
  props: {
    pubkey: {type: String, required: true},
    alignRight: {type: Boolean, default: false},
    size: {type: String, default: ''},
    round: {type: Boolean, default: false},
    bordered: {type: Boolean, default: false},
    showVerified: {type: Boolean, default: false},
    hoverEffect: {type: Boolean, default: false},
  },

  computed: {
    picture() {
      return this.$store.state.profilesCache[this.pubkey]?.picture || ''
    },
    identicon() {
      return identiconFor(this.pubkey, this.$store.state.config?.preferences?.color)
    },
    // the picture once its shared request has loaded; the identicon until
    // then, and for good if it fails or there is none
    src() {
      return this.picture && pictureState[this.picture] === 'ok' ? this.picture : this.identicon
    },
  },

  watch: {
    picture: {
      handler(url) { loadPicture(url) },
      immediate: true,
    },
  },

  methods: {
    // a picture that loaded but won't decode in an <img>
    onError() {
      if (this.src !== this.picture) return
      pictureState[this.picture] = 'failed'
      markImageFailed(this.picture)
    },
  },
}
</script>

<style lang='css' scoped>
.avatar-img {
  background-size: cover;
  background-position: center;
}
.bordered-avatar .q-avatar img {
  border: 2px solid var(--q-accent);
  background: var(--q-background);
  z-index: 1;
}
.hovered-avatar .q-avatar:hover {
  transform: scale(1.5) translateX(.25rem);
}
.icon-right {
  position: absolute;
  top: -.4rem;
  right: -.5rem;
}
.icon-left {
  position: absolute;
  top: -.4rem;
  left: -.5rem;
}
</style>
