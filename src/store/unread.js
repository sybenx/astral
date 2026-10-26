import {
  streamMainMentions,
  streamMainIncomingMessages,
} from '../query'
import { watch } from 'vue'
import { debounce } from 'quasar'
import { nip17State, nip17Chats, nip17UnreadFrom } from '../nostr/nip17'

export default function (store) {
  // Unread mentions are counted from the mentions stream itself (its newest
  // 200, then each new one). Recounting used to fetch every mention since you
  // last looked, from every relay, on each new mention: hundreds of requests
  // a second for an account that gets mentioned a lot, on every screen.
  const unreadMentions = new Map() // id → created_at
  let mentionsOwner = null
  const setUnreadNotifications = () => {
    const since = store.state.lastNotificationRead || 0
    for (const [id, at] of unreadMentions) if (at <= since) unreadMentions.delete(id)
    store.commit('setUnreadNotifications', unreadMentions.size)
  }
  const setUnreadNotificationsSoon = debounce(setUnreadNotifications, 500)
  const addMentions = events => {
    const me = store.state.keys.pub
    const since = store.state.lastNotificationRead || 0
    for (const event of events) {
      if (event && event.pubkey !== me && event.created_at > since) unreadMentions.set(event.id, event.created_at)
    }
  }

  // Unread DMs likewise, from the incoming-messages stream: it used to be a
  // fetch from every relay per sender, again on each new message.
  const incoming = new Map() // peer → Map(id → created_at)
  const addIncoming = event => {
    if (!event || event.pubkey === store.state.keys.pub) return false
    if (!incoming.has(event.pubkey)) incoming.set(event.pubkey, new Map())
    incoming.get(event.pubkey).set(event.id, event.created_at)
    return true
  }
  const setUnreadMessages = peer => {
    const since = store.state.lastMessageRead[peer] || 0
    let count = 0
    for (const at of incoming.get(peer)?.values() || []) if (at > since) count++
    store.commit('setUnreadMessages', { peer, count: count + nip17UnreadFrom(peer, since) })
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
      if (mentionsOwner !== store.state.keys.pub) {
        mentionsOwner = store.state.keys.pub
        unreadMentions.clear()
        incoming.clear()
      }
      if (sub.streamMainMentions) sub.streamMainMentions.update({ authors: [store.state.keys.pub], relays })
      else sub.streamMainMentions = await streamMainMentions({ authors: [store.state.keys.pub], relays },
        events => {
          addMentions(events)
          if (streamMainMentionsEose) setUnreadNotificationsSoon()
        },
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
            if (!addIncoming(event)) continue
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
