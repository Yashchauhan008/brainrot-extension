// Focus Meter — background service worker (fully offline, no server).
// Owns the local swipe log in chrome.storage.local so counting is race-free
// across tabs. Content scripts report "WATCH_EVENT"; the popup edits settings.

const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days of history for Insights

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

// Serialize record operations so two tabs firing at once can't lose writes.
let recordChain = Promise.resolve();

// A watch event is just "one swipe-up on <platform>" — no video ids stored.
function recordWatch(platform) {
  recordChain = recordChain.then(async () => {
    const { watchedShortform } = await storageGet({ watchedShortform: [] });
    const cutoff = Date.now() - KEEP_MS;
    const entries = watchedShortform.filter((e) => e.ts > cutoff);
    entries.push({ platform, ts: Date.now() });
    await storageSet({ watchedShortform: entries });
  });
  return recordChain;
}

// Upgrade from the server-backed version: drop leftovers, keep local counts.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(["auth", "outbox", "dataVersion"]);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WATCH_EVENT") {
    recordWatch(message.platform).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Keyboard shortcut: block until midnight. Deliberately block-only — turning
// the block off goes through the popup's cooling-off delay.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "block-now") return;
  const { settings } = await storageGet({ settings: null });
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  await storageSet({ settings: { ...(settings || {}), manual_block_until: d.getTime() } });
});
