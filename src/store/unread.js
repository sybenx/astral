import {
  dbChats,
  dbUnreadMessagesCount,
  dbUnreadMentionsCount,
  streamMainMentions,
  streamMainIncomingMessages,
} from '../query'
import { watch } from 'vue'
import { debounce } from 'quasar'
import { nip17State, nip17Chats, nip17UnreadFrom } from '../nostr/nip17'

export default function (store) {
  const setUnreadNotifications = async () => {
    store.commit(
      'setUnreadNotifications',
      await dbUnreadMentionsCount(
        store.state.keys.pub,
        store.state.lastNotificationRead
      )
    )
  }

  const setUnreadMessages = async peer => {
    const since = store.state.lastMessageRead[peer] || 0
    store.commit('setUnreadMessages', {
      peer,
      count: await dbUnreadMessagesCount(store.state.keys.pub, peer, since) + nip17UnreadFrom(peer, since)
    })
  }

  // NIP-17 messages count too, as they're unwrapped
  watch(() => nip17State.version, debounce(() => {
    if (!store.state.keys.pub) return
    for (const peer of nip17Chats().keys()) if (peer !== store.state.keys.pub) setUnreadMessages(peer)
  }, 1000))

  let sub = {}
  const streamMentionsAndMessages = async () => {
    let relays = Object.keys(store.state.relays).length ? Object.keys(store.state.relays) : Object.keys(store.state.defaultRelays)
    let streamMainMentionsEose = false
    let streamMainIncomingMessagesEose = false
    let streamMainIncomingMessagesPeers = {}
    if (store.state.keys.pub) {
      if (sub.streamMainMentions) sub.streamMainMentions.update({ authors: [store.state.keys.pub], relays })
      else sub.streamMainMentions = await streamMainMentions({ authors: [store.state.keys.pub], relays },
        () => { if (streamMainMentionsEose) setUnreadNotifications() },
        () => {
          if (!streamMainMentionsEose) {
            streamMainMentionsEose = true
            setUnreadNotifications()
          }
        })

      if (sub.streamMainIncomingMessages) sub.streamMainIncomingMessages.update({ authors: [store.state.keys.pub], relays })
      else sub.streamMainIncomingMessages = await streamMainIncomingMessages({ authors: [store.state.keys.pub], relays },
        events => {
          for (const event of events) {
            if (!event) continue
            if (streamMainIncomingMessagesEose) setUnreadMessages(event.pubkey)
            else streamMainIncomingMessagesPeers[event.pubkey] = true
          }
        },
        () => {
          if (!streamMainIncomingMessagesEose) {
            streamMainIncomingMessagesEose = true
            for (let pubkey of Object.keys(streamMainIncomingMessagesPeers)) setUnreadMessages(pubkey)
          }
        })

      setUnreadNotifications()
      dbChats(store.state.keys.pub).then(chats => { chats.forEach(chat => { setUnreadMessages(chat.peer) }) })
    }
  }


  // Mentions and messages stream only while someone can see the page: they
  // stop after 30s in a hidden tab and restart (recounting) when it's back.
  const HIDDEN_GRACE = 30 * 1000
  let hiddenTimer = null
  let paused = false
  const pause = () => {
    for (const key of Object.keys(sub)) {
      sub[key]?.cancel()
      delete sub[key]
    }
    paused = true
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer)
    if (document.hidden) {
      hiddenTimer = setTimeout(pause, HIDDEN_GRACE)
    } else if (paused) {
      paused = false
      streamMentionsAndMessages()
    }
  })

  store.subscribeAction(({type, payload}, state) => {
    switch (type) {
      case 'restartMainSubscription':
        if (!paused) streamMentionsAndMessages()
        break
    }
  })

  store.subscribe(({type, payload}, state) => {
    switch (type) {
      case 'haveReadNotifications':
        setUnreadNotifications()
        break
      case 'haveReadMessage':
        setUnreadMessages(payload)
        break
    }
  })
}
