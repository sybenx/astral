# Vendored: Cosign sign-in and import (site side)

Copied unchanged from [sybenx/cosign](https://github.com/sybenx/cosign) `main` at
commit 5b2d454 (after 90aafcf, where the app became Marble; the protocol, servers and repository
stay Cosign; full hash in `COSIGN-COMMIT`):

- `src/pair.ts`, `src/ticket.ts`, `src/client.ts`: signing in with a phone
- `src/import.ts`, `src/member.ts`, `src/servers.ts`: moving a key held by this page into Cosign
- `vendor/` from `site/vendor/` (QRST core and web adapters, QRST commit 46ee02b)

Do not edit these files; update them by copying a newer commit. Astral's glue lives in
`src/nostr/signIn.js`. MIT licensed (`LICENSE`, `vendor/QRST-LICENSE`).
