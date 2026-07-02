# Brain Rot Counter 🧠 — Extension

Chrome extension that counts Instagram Reels and YouTube Shorts you watch,
shows a floating brain bubble with the merged 24h count, and syncs everything
to the BrainRot server so you can compete with friends on the portal.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Open the portal (`http://localhost:3010`), sign up / log in — the extension
   connects automatically (the dashboard shows "Extension connected")
4. Open Instagram Reels or YouTube Shorts — the bubble tracks you

## How it works

- **Login gate** — until you log in on the portal, the bubble shows a
  "Login to track" button and nothing is counted.
- **content.js** watches the SPA URL for `/reels/{id}` / `/shorts/{id}` and
  reports new videos to the background worker.
- **background.js** owns all state in `chrome.storage.local`:
  - `auth` — JWT + user handed over from the portal
  - `watchedShortform` — rolling 24h window (drives the bubble, deduped,
    merged across both platforms)
  - `outbox` — events waiting to be synced; flushed to
    `POST /events/batch` immediately and retried every 30s (offline-safe)
- **connect.js** runs only on the portal origin and receives the JWT via
  `postMessage` after login (and clears it on logout).
- Counts update live in every open tab via `chrome.storage.onChanged`.

## Config

API and portal URLs are constants at the top of `background.js`
(`http://localhost:3017` / `http://localhost:3010`) — change them when you
deploy.
