import { defineAsyncComponent } from 'vue'
import BaseUserName from '../components/BaseUserName.vue'
import BaseUserAvatar from '../components/BaseUserAvatar.vue'
import BaseUserCard from '../components/BaseUserCard.vue'
import BaseHeader from '../components/BaseHeader.vue'

// Posts and the post box (markdown-it, link previews, the editor) load next to
// the relays rather than before the first paint: the page shell shows first
// and posts appear as soon as both their code and their events are in.
const BasePost = defineAsyncComponent(() => import('../components/BasePost.vue'))
const BasePostThread = defineAsyncComponent(() => import('../components/BasePostThread.vue'))
const BasePostEntry = defineAsyncComponent(() => import('../components/BasePostEntry.vue'))

export default ({app}) => {
  app.component('BasePost', BasePost)
  app.component('BaseUserName', BaseUserName)
  app.component('BaseUserAvatar', BaseUserAvatar)
  app.component('BaseUserCard', BaseUserCard)
  app.component('BasePostEntry', BasePostEntry)
  app.component('BasePostThread', BasePostThread)
  app.component('BaseHeader', BaseHeader)
}
