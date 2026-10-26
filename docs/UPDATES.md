# Updates worth making

> **2026-10-26, the user's rule: "keep it true, mostly fix bugs and jank."** See the top of FEEL.md.
> Done: #1, #2, #3, #4, #5, #7, #8, #11, #12–#16, #19, #20, #21. Still open, judged by that rule:
> - **Bug or jank fixes, fine to do:** #10 (the rest of the memory sweep: iOS tab crashes) and #9's
>   remaining bundle split (first load on a phone).
> - **Wait until the user asks:** #6 (Vuex → Pinia: a refactor, not a fix), #17 (lists as feeds),
>   #22 (NIP-17 DMs), #18's profile-search half (search was already redone). #23 stays declined.

Read with [FEEL.md](FEEL.md). **Decided 2026-10-24:** the user approved #1, #2, #9–#14, #20 (lowercase),
and #21. #23 (Spark) is declined. Everything else waits until asked. Each item has a tag:

- **invisible**: nobody should notice, except that it's faster or breaks less.
- **feel, slightly**: something small shows up or looks a little different.
- **feel**: it changes how Astral looks or behaves.

Effort is rough: **S** = under half a day, **M** = 1–3 days, **L** = a week or more. Backlog numbers
(#n) refer to "NDK / nostr modernization backlog" in DEV_NOTES.md.

Installed versions as of 2026-10-24: `@quasar/app-vite` 1.11 (so **Vite 2.9**), quasar 2.20, vue 3.5,
pinia 2.3, vuex 4.1, `@nostr-dev-kit/ndk` **2.10.0, pinned exactly**, dexie 3.2, nostr-tools 2.25.
The npm registry wasn't reachable from here, so I haven't compared against the latest releases. Run
`npm outdated` before picking.

## Foundations (invisible)

| # | Update | Effort | Why |
|---|---|---|---|
| 1 | `@quasar/app-vite` v1 → v2 (a current Vite, ESM `quasar.config`) | M | Vite 2.9 has been unsupported for years, and newer plugins and fixes need a newer Vite. Most of the work is the config and the node-polyfills plugin. Do this first; it makes the others easier. |
| 2 | Make `npm run lint` work again (`@babel/eslint-parser` is missing) | S | Lint currently errors on every file, so it catches nothing. |
| 3 | NDK 2.10 → current 2.x, then drop the workarounds (`collect()` for the `fetchEvents` hang on `#p`, the BunkerSigner swap) | M | It's pinned exactly, so it gets no fixes. Needs a careful test of sign-in, the feed and DMs. |
| 4 | dexie 3 → 4 with ndk-cache-dexie, cache expiry, and a DB name (#12) | S–M | The cache grows without limit today. |
| 5 | Delete dead code: the `src/*.worker.js` files (#13), the dead 2022 default relays in `store/state.js` (#14) | S | It's less to read, and stops people editing the wrong relay list. |
| 6 | Finish Vuex → Pinia (DEV_NOTES "Phase 4") | L | Two stores side by side is the main source of confusing bugs (today's mnemonic bug lived in that seam). |
| 7 | Smaller backlog items: profile batching (#2), NIP-65 via `NDKRelayList` (#5), kind-3 without relay JSON (#6), chunk authors to ≤500 (#7), visibility gating for `unread.js` (#11), sign through NDK always (#15) | S each | Correctness and memory. |
| 8 | Deploy config: drop or update `vercel.json` and the Dockerfile now that `wrangler.jsonc` + `npm run deploy` is the real path | S | Two stale deploy paths will confuse the next person. |

## Phones (invisible)

| # | Update | Effort | Why |
|---|---|---|---|
| 9 | Split the 2.1 MB main bundle: load markdown and highlight.js, emoji-mart, Bitcoin Connect, and codemirror only when needed | M | First load on a phone over cellular. Nothing else changes. |
| 10 | Finish the memory sweep from DEV_NOTES: the DM list, the follow-reorder Draggable, then images (measure on a device first, then cap decode size using imeta dimensions) | M | iOS Safari still has the per-tab memory ceiling that caused the OOM crashes. |
| 11 | Link previews: replace microlink (25 a day per viewer IP; it also sees every link you scroll past) with a small OG-tag fetcher on our own Cloudflare Worker, cached | S–M | The 429 backoff (shipped 2026-10-24) only hides the limit. This removes it and keeps the links you view private. |

## Small visible changes (feel, slightly)

| # | Update | Effort | Notes |
|---|---|---|---|
| 12 | Accessibility: labels on icon-only buttons (only one `aria-label` in the whole app today), visible keyboard focus, `prefers-reduced-motion` | S–M | Invisible to most people. |
| 13 | Contrast: the mono accent `#777` on `#1f1f1f` is about 3.7:1, under the 4.5:1 WCAG AA minimum wherever accent is used for text | S | Fixing it means a slightly lighter grey in mono. Your call. |
| 14 | PWA install: re-enable the service worker (`pwa: false` + `unregister-sw.js` today), manifest in the theme colours | M | Phones can add Astral to the home screen. Keep it silent (no install banner) to stay "nothing pushy". |
| 15 | Respect your NIP-51 mute list from other clients, plus "mute" in the ⋮ menu | S–M | Not supported at all today. |
| 16 | Outbox reads for the follows feed (fetch each author from their own write relays). NDK has `enableOutboxModel` on, but the feed engine still asks one fixed relay set | M | Mostly invisible: the follows feed gets more complete. |
| 17 | Lists as feeds: your NIP-51 follow sets in the follows / global picker | M | Fits the original's "bots" feed option. |
| 18 | NIP-57 zaps via `NDKZapper` (#1), profile search via NDK instead of a hand-rolled Primal socket (#10) | M each | Mostly invisible. |
| 19 | Revive or remove the dev tools SQL editor (its database is gone; it returns nothing) | S to remove, M to rebuild on the Dexie cache | It's a power-user door from the original. |

## Bigger changes (feel)

| # | Update | Effort | Notes |
|---|---|---|---|
| 20 | **Lowercase or sentence case:** pick one and apply it everywhere. Today the sign-in dialog is sentence case and the rest is lowercase. | S | See FEEL.md "Voice". |
| 21 | Replies shown as threads in the feed again (the original fetched the root and showed the reply under it) | M | Brings back the original; adds fetches per reply. |
| 22 | NIP-17 private DMs (#3). NIP-44 already exists in `encryptionService.js` | L | Messages get private metadata. Old NIP-04 DMs should stay readable. Needs NIP-44 from each signer, Cosign included. |
| 23 | ~~Spark wallet~~ (DEV_NOTES "Next" #1; big WASM) | L | **Declined** by the user on 2026-10-24: Astral stays a client, not a wallet app. |

## Suggested order

1 → 2 → 11 → 12 → 10 → 9, then pick from the rest once FEEL.md is settled. 20 is quick but needs a
decision first.
