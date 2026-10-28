import {LocalStorage} from 'quasar'
import { DEFAULT_RELAYS, OPTIONAL_RELAYS } from '../nostr/ndk'

const isClientUsingTor = () => window.location.hostname.endsWith('.onion')

const mainnetDefaultRelays = Object.fromEntries(DEFAULT_RELAYS.map(url => [url, { read: true, write: true }]))

const torDefaultRelays = {
  'ws://jgqaglhautb4k6e6i2g34jakxiemqp6z4wynlirltuukgkft2xuglmqd.onion': {
    read: true,
    write: true
  },
  'ws://wagvwfrdrikrqzp7h3b5lwl6btyuttu7mqpeji35ljzq36ovzgjhsfqd.onion': {
    read: true,
    write: true
  }
}

export default function () {
  const defaultRelays = isClientUsingTor() ? torDefaultRelays : mainnetDefaultRelays
  const optionalRelaysList = isClientUsingTor() ? Object.keys(torDefaultRelays) : OPTIONAL_RELAYS
  let config = LocalStorage.getItem('config')
  let { timestamps, preferences } = config || {}
  let { lastUserMainSync = 0, lastFeedLoad = 0 } = timestamps || {}
  let { color, font = 'Roboto', lightningTips } = preferences || {}
  let { primary = '#ffffff', secondary = '#aaaaaa', accent = '#888888', background = '#1f1f1f' } = color || {}
  // mono's accent was #777777 (3.7:1 on #1f1f1f); #888888 reaches 4.5:1 for text
  if (primary === '#ffffff' && secondary === '#aaaaaa' && accent === '#777777') accent = '#888888'
  let { enabled = true, lastMode = 'copy', lastWallet = null, presets = [10, 100, 1000], oneClick = { enabled: false, amount: 10 } } = lightningTips || {}
  config = {
    timestamps: {
      lastUserMainSync,
      lastFeedLoad
    },
    preferences: {
      color: {
        primary,
        secondary,
        accent,
        background
      },
      font,
      lightningTips: {
        enabled,
        lastMode,
        lastWallet,
        presets,
        oneClick,
      }
    }
  }

  return {
    keys: LocalStorage.getItem('keys') || {}, // {priv, pub }

    relays: LocalStorage.getItem('relays') || {}, // { [url]: {} }
    defaultRelays, // { [url]: {} }
    optionalRelaysList, // [ urls... ]
    follows: LocalStorage.getItem('follows') || [], // [ pubkeys... ]

    profilesCache: {}, // { [pubkey]: {name, about, picture, ...} }
    profilesCacheLRU: [], // [ pubkeys... ]
    eventsCache: {}, // { [id]: event }
    eventsCacheLRU: [], // [ ids... ]
    contactListCache: {}, // { [pubkey]: {name, about, picture, ...} }
    contactListCacheLRU: [], // [ pubkeys... ]
    nip05VerificationCache: {}, // { [identifier]: {pubkey, when }

    lastMessageRead: LocalStorage.getItem('lastMessageRead') || {},
    unreadMessages: {},

    lastNotificationRead: LocalStorage.getItem('lastNotificationRead') || 0,
    unreadNotifications: 0,

    config
  }
}
