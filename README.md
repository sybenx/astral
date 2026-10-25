# Astral

Astral is a web client for interacting with [Nostr](https://github.com/nostr-protocol/nostr), a protocol that attempts to make decentralized social media a reality.

This is a revival of [astral](https://github.com/monlovesmango/astral) (astral.ninja), the original Nostr client by [monlovesmango](https://github.com/monlovesmango), which itself began as a fork of [Branle](https://github.com/fiatjaf/branle) by [fiatjaf](https://github.com/fiatjaf). It is built on [Lunar](https://github.com/dmnyc/lunar) by [dmnyc](https://github.com/dmnyc), a full technical overhaul of astral that modernized the stack (Vite, NDK, Pinia) and added NIP-07/NIP-46 signers, NWC + lightning zaps (NIP-57), and more, while keeping astral's original design and aesthetic.

Lineage: Branle → astral → Lunar → Astral.

## Install the dependencies
```bash
yarn
# or
npm install
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
yarn dev
# or
npm run dev
# or if quasar installed locally
quasar dev
```

### Lint the files
```bash
yarn lint
# or
npm run lint
```

### Format the files
```bash
yarn format
# or
npm run format
```

### Build the app for production in PWA mode:
```bash
yarn build:pwa
# or
npm run build:pwa
# or if quasar installed locally
quasar build -m pwa
```

### Build the app for production in SPA mode:
Set `SITE_URL` (e.g. `SITE_URL=https://example.com`) so the social preview tags in `index.html` use absolute URLs.

```bash
yarn build:spa
# or
npm run build:spa
# or if quasar installed locally
quasar build
```

## Deploy

astral.syb.lol runs on a Cloudflare Worker (`wrangler.jsonc`): the PWA build is served as static assets, and `worker/index.js` answers `/api/*` (link previews).

```bash
npm run deploy
```

This builds in PWA mode and runs `wrangler deploy`.
