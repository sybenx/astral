# What makes Astral feel like Astral

A checklist for any change. The sources are the original astral (monlovesmango, last upstream commit
`9216578`, Feb 2023), the current app and DEV_NOTES.md. Each rule is marked:

- **[seen]**: it's in the original code or the app today.
- **[guess]**: my reading of the spirit. Correct these.
- **[confirmed]**: the user confirmed or decided it (2026-10-24).

## Look

- **keep: the mono default.** White, grey and dark grey on near-black (`#ffffff` / `#aaaaaa` / `#888888`
  on `#1f1f1f`). This was the 2022 default; purple and gold is the separate "astral" theme. [seen] The
  accent grey went from `#777777` to `#888888` so text in it meets 4.5:1 contrast. [confirmed]
- **keep: the theme list, names and all.** astral, mono, zen lisa frank, nostrich, dusk, camo, warm,
  cool, southwest, dracula, poimandres. [seen]
- **keep: a theme is just four colours** (primary, secondary, accent, background), and any font from the
  ~200 Google Fonts on offer (Roboto by default). [seen]
- **never: hard-code a colour in new UI.** Build it from those four CSS variables, or every theme but one
  breaks. [guess, but it follows from the above]
- **keep: flat.** Posts sit straight on the background, separated by a 2px accent line at 25% opacity. No
  cards, shadows or gradients around posts. [divider seen; no cards or shadows confirmed]
- **keep: Material icons and Quasar's plain flat or outline buttons.** A filled primary button is white
  with dark text. [seen]

## Layout

- **keep: three columns on a desktop.** Your menu on the left, the page in the middle, and search plus your
  follows list on the right. Phones get a bottom bar instead. [seen]
- **keep: big, bold, lowercase page titles** ("feed", "notifications"), with the picker right next to
  the title (follows / global). [seen]
- **keep: a strictly reverse-chronological feed.** New posts wait behind a "load N new" button and are
  never pushed in while you read. The original said "load N unread". [seen]
- **keep: a dense post layout.** Avatar, short npub above the name, NIP-05 check, short relative time
  (5s, 3m), ⋮ menu. Text first; media doesn't take over. [layout seen; "media doesn't take over" a guess]
- **keep: replies as threads in the feed.** A reply shows under the post it answers, as in the original,
  not on its own with an "in reply to nevent1…" link. [confirmed]
- **keep: bare Nostr addresses as URLs.** `/npub1…`, `/note1…`, `/nevent1…`, `/hashtag/x`. A profile or a
  thread is just a page you can link. [seen]

## Voice

- **keep: lowercase UI words.** "post", "follow", "set user", "reorder follows", "welcome to astral".
  [seen, in i18n/en and across the original]
- **keep: candid and a bit playful.** It explains instead of selling. The original FAQ tells you plainly
  not to trust the client with your key. [seen]
- **keep: lowercase everywhere**, including the sign-in dialog. The sentence case it got briefly on
  2026-10-24 was reverted. Names stay capitalised (Nostr, Cosign, Amber). Messages from shared code show
  with a lowercase first letter (`lowerFirst` in `utils/helpers.js`). [confirmed]
- **never: growth copy.** No streaks, "you're missing out", nags to finish your profile, or upsells.
  [guess]

## Habits

- **keep: no algorithm.** The feeds are follows and global (the original also had "bots"). Nothing gets
  injected, ranked or "suggested", ever. [feeds seen; nothing injected confirmed]
- **keep: you can look around without an account.** Closing the welcome dialog drops you into the
  global feed. [seen]
- **keep: power-user doors left open.** Raw event view, which relays a note was seen on, the dev tools
  page with its SQL editor, per-relay read/write, and drag to reorder follows. [seen] The SQL editor
  has returned nothing since the Lunar overhaul removed its database (`dbQuery` returns `[]`).
- **keep: the post ⋯ menu is labelled**, icon plus word: bookmark (or remove bookmark), copy link (a plain
  njump.me link anyone can open), share (the phone's share sheet, else copy), translate (only when your own
  LibreTranslate server is set and the post looks like another language), and more › for metadata and
  seen on relays. [confirmed]
- **keep: bookmarks are the standard Nostr list**, so they follow the account to other apps, with their own
  page in the menu. Translation only ever goes through a server the reader sets up. [confirmed]
- **keep: nothing pushy.** No permission prompts on load, no autoplay with sound. Astral can be
  installed to the home screen, but it never asks or shows an install banner. [no install nag confirmed]
  Lightning tips can be turned off in settings. [tips toggle seen; the rest a guess]
- **keep: honest about keys.** It says where your key lives and what each sign-in method trusts.
  The "protect your account" nudge should stay a single dismissable banner, not a recurring
  interruption. [explanations seen; "single banner" a guess]
