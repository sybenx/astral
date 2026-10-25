export default function (store) {
  store.subscribe(({type, payload}, state) => {
    switch (type) {
      // these mutations change the state after user manual inputs
      // different from 'setRelays' and 'setFollows', which change the state
      // in bulk and are committed only on startup
      case 'addRelay':
      case 'removeRelay':
      case 'setRelayOpt':
      case 'saveRelays':
        // relays: the NIP-65 list (kind 10002)
        store.dispatch('publishRelayList')
        break
      case 'follow':
      case 'unfollow':
      case 'reorderFollows':
        // follows: the contact list (kind 3)
        store.dispatch('publishContactList')
        break
    }
  })
}
