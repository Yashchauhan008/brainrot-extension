# Brain Rot Counter 🧠 — Extension

Chrome extension that counts how many Instagram Reels and YouTube Shorts you
swipe through, shows a floating brain bubble with your last-24h count, and
syncs everything to the BrainRot portal so you can compete with friends.

**Live portal:** https://brainrot.quicklabs.pro
**Live API:** https://api.brainrot.quicklabs.pro

## Setup (end user)

1. Download / clone this repo (you only need the `extension/` folder).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and select the `extension/` folder.
5. Go to https://brainrot.quicklabs.pro and **sign up / log in**
   (you'll get a 6-digit code by email to verify).
   The dashboard will show **"🧩 Extension connected"**.
6. Open Instagram Reels or YouTube Shorts — the brain bubble appears and
   starts counting. That's it.

No video IDs or browsing history are collected — the extension only counts
swipes per platform.

## What you get

- **Brain bubble** — draggable counter on Reels/Shorts pages showing your
  rolling 24h swipe count. Logged out, it shows a "Login to track" button
  and counts nothing.
- **Rotting brain** — the icon decays in 4 stages as you pass 1×, 2×, 3× of
  your daily target (default 50).
- **Screen fade** — past the target, every extra video darkens the page a
  bit more (up to 88% black).
- **Hard block** — optional: at the target, Reels/Shorts get fully walled off
  until your 24h window frees up.
- **Milestone popups** — a one-time roast each time you cross 2× the target.
- **Friends leaderboard** — double-click the bubble for today's counts of you
  and your friends (lowest wears the crown 👑), plus a link to the portal.

Every effect can be toggled (and the daily target changed) on the portal:
**https://brainrot.quicklabs.pro/settings** — changes apply instantly.
Invite friends from **https://brainrot.quicklabs.pro/friends** (one active
invite code at a time).

## Notes

- The bubble shows a **rolling 24h window**; the portal's "Today" card is the
  UTC calendar day. The portal's "Last 24 hours" card matches the bubble.
- Counts survive offline: events queue locally and sync as soon as the
  server is reachable (every ~30s).
- Logging in with a different account resets the local counter — counts
  never leak between accounts.

## How it works (for developers)

- **content.js** watches the SPA URL for `/reels/…` / `/shorts/…`, counts
  swipe-ups (back-swipes don't count) and renders the bubble + effects.
- **background.js** owns all state in `chrome.storage.local`:
  - `auth` — JWT + user handed over from the portal
  - `watchedShortform` — rolling 24h window (drives the bubble)
  - `outbox` — pending events, flushed to `POST /events/batch`, retried
    every 30s (offline-safe, idempotent via random `client_event_id`)
  - `settings` — effect toggles, synced from the server and pushed
    instantly by the portal
- **connect.js** runs only on the portal origin and bridges the JWT and
  settings via `postMessage`.
- Counts and effects update live in every open tab via
  `chrome.storage.onChanged`.

### Local development

API and portal URLs are constants at the top of `background.js` — swap the
commented `localhost` values (`http://localhost:3017` /
`http://localhost:3010`) in and reload the extension. The manifest already
includes both live and localhost host permissions.
