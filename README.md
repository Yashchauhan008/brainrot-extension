# Focus Meter 🧠 (formerly Brain Rot Counter)

Chrome extension that counts the Instagram Reels and YouTube Shorts you swipe
through and can **block them on command**. Fully offline — no account, no
server, no network requests. Everything lives in `chrome.storage.local`.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select this folder.
3. Refresh any open Instagram / YouTube tabs.

## Features

- **Block on command** — toolbar popup: 1 hour, 2 hours, until midnight, or
  until you unblock. A full-screen wall covers Reels/Shorts and videos pause.
- **Unblock friction** — unblocking early needs a 30s countdown in the popup
  (keep the popup open).
- **Shortcut** — `Alt+Shift+B` blocks until midnight (rebind at
  `chrome://extensions/shortcuts`). It only blocks; unblocking goes via the popup.
- **Daily schedule** — recurring block window (e.g. 22:00–06:00).
- **Feed videos** — optional: Instagram feed videos are paused, muted and
  covered with a static thumbnail instead of autoplaying.
- **Entry points hidden** — while blocked, Shorts/Reels buttons and shelves
  are hidden from the page.
- **Counter bubble** — draggable count of today's swipes, rotting-brain icon,
  screen fade and milestone popups past your daily target, optional hard block
  at the target. All toggles are in the popup.

No video IDs or history are stored — only a per-platform timestamp per swipe
(kept 30 days).

## Files

- `content.js` — detects reels/shorts, bubble, effects, block wall
- `background.js` — owns the swipe log, handles the shortcut
- `popup.html` / `popup.js` / `popup-ui.css` — popup with Focus, Insights (7/30-day chart, averages, streak, peak hour) and Settings tabs
- `popup.css` — styles injected into Instagram/YouTube
