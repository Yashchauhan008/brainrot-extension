# Chrome Web Store submission notes

Everything the listing form asks for, pre-written. Do not ship this file in
the zip (the packaging command below excludes it).

## Package

From the repo root:

```sh
cd brainrot
zip -r brainrot-extension-v2.1.0.zip extension \
  -x "extension/README.md" -x "extension/STORE.md" -x "*.DS_Store" \
  -x "extension/.git/*" -x "extension/.git*"
```

Upload the zip at https://chrome.google.com/webstore/devconsole (one-time $5
developer fee).

## Single purpose (asked in the review form)

> Counts how many Instagram Reels and YouTube Shorts the user watches and
> displays that count with optional screen-time effects, synced to the
> user's BrainRot account so they can compete with friends.

## Permission justifications

- **storage** — keeps the local 24h swipe counter, the user's login token
  and their effect settings on the device.
- **alarms** — periodically syncs queued watch counts and settings with the
  BrainRot server (service workers can't use timers reliably).
- **host_permissions `https://api.brainrot.quicklabs.pro/*`** — the
  extension's own backend; used to upload swipe counts and fetch the user's
  settings and friends leaderboard.
- **Content script on instagram.com / youtube.com** — detects when the user
  is on a Reels/Shorts page to count swipes and render the counter bubble
  and effects. No page content is read or collected.
- **Content script on brainrot.quicklabs.pro** — the extension's own portal;
  receives the login token after the user signs in.

## Privacy disclosures (data usage tab)

- Collected: **authentication information** (login token), **website
  activity limited to swipe counts per platform** (a number — no URLs, no
  video IDs, no page content).
- Not collected: browsing history, page contents, personal communications,
  location, financial data.
- Data is sent only to `api.brainrot.quicklabs.pro`, tied to the user's own
  account, never sold or shared.

## Listing assets still needed

- Screenshots: 1280×800 — bubble on a Short, hard-block wall, portal
  dashboard (take these manually).
- Small promo tile 440×280 (optional but recommended).
- Privacy policy URL — host a short page on the portal, e.g.
  `https://brainrot.quicklabs.pro/privacy`, restating the section above.
