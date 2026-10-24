import { boot } from 'quasar/wrappers'
import createStore from '../store'

// @quasar/app-vite v2 only wires up Pinia on its own, so install the legacy
// Vuex store (feed/profile UI) here until the Pinia migration finishes.
export default boot(({ app }) => {
  app.use(createStore())
})
