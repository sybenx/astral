# What makes Astral feel like Astral

A checklist for any change. The sources are the original astral (monlovesmango, last upstream commit
`9216578`, Feb 2023), the current app and DEV_NOTES.md. Each rule is marked:

- **[seen]**: it's in the original code or the app today.
- **[guess]**: my reading of the spirit. Correct these.

## Look

- **keep: the mono default.** White, grey and dark grey on near-black (`#ffffff` / `#aaaaaa` / `#777777`
  on `#1f1f1f`). This was the 2022 default; purple and gold is the separate "astral" theme. [seen]
- **keep: the theme list, names and all.** astral, mono, zen lisa frank, nostrich, dusk, camo, warm,
  cool, southwest, dracula, poimandres. [seen]
- **keep: a theme is just four colours** (primary, secondary, accent, background), and any font from the
  ~200 Google Fonts on offer (Roboto by default). [seen]
- **never: hard-code a colour in new UI.** Build it from those four CSS variables, or every theme but one
  breaks. [guess, but it follows from the above]
- **keep: flat.** Posts sit straight on the background, separated by a 2px accent line at 25% opacity. No
  cards, shadows or gradients around posts. [divider seen; "no cards or shadows" a guess]
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
- **open question: replies in the feed.** The original showed a reply under the post it answers (a
  thread). Lunar shows replies on their own with an "in reply to nevent1…" link. [both seen]
- **keep: bare Nostr addresses as URLs.** `/npub1…`, `/note1…`, `/nevent1…`, `/hashtag/x`. A profile or a
  thread is just a page you can link. [seen]

## Voice

- **keep: lowercase UI words.** "post", "follow", "set user", "reorder follows", "welcome to astral".
  [seen, in i18n/en and across the original]
- **keep: candid and a bit playful.** It explains instead of selling. The original FAQ tells you plainly
  not to trust the client with your key. [seen]
- **conflict, decide: the sign-in dialog went to sentence case** on 2026-10-24 ("Sign in",
  "Welcome to Astral"). That was asked for as part of the phone polish, but it breaks the rule above.
  [seen]
- **never: growth copy.** No streaks, "you're missing out", nags to finish your profile, or upsells.
  [guess]

## Habits

- **keep: no algorithm.** The feeds are follows and global (the original also had "bots"). Nothing gets
  injected, ranked or "suggested". [feeds seen; "nothing injected" a guess]
- **keep: you can look around without an account.** Closing the welcome dialog drops you into the
  global feed. [seen]
- **keep: power-user doors left open.** Raw event view, which relays a note was seen on, the dev tools
  page with its SQL editor, per-relay read/write, and drag to reorder follows. [seen] The SQL editor
  has returned nothing since the Lunar overhaul removed its database (`dbQuery` returns `[]`).
- **keep: nothing pushy.** No permission prompts on load, no autoplay with sound, no install nag.
  Lightning tips can be turned off in settings. [tips toggle seen; the rest a guess]
- **keep: honest about keys.** It says where your key lives and what each sign-in method trusts.
  The "protect your account" nudge should stay a single dismissable banner, not a recurring
  interruption. [explanations seen; "single banner" a guess]
