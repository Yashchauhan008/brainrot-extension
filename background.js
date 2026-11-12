// Focus Meter — background service worker (fully offline, no server).
// Owns the swipe log in chrome.storage.local so counting is race-free across
// tabs. Two stores:
//   watchedShortform — raw swipe events, only the last ~2 days (drives the
//                      bubble / effects, which only need "today").
//   dailyStats       — lifetime history, one tiny row per day:
//                      { "YYYY-MM-DD": { ig, yt, h: [24 hourly counts] } }
// Content scripts report "WATCH_EVENT"; the popup edits settings.

const RAW_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function keyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToStats(stats, platform, ts) {
  const k = keyOf(ts);
  const s = stats[k] || (stats[k] = { ig: 0, yt: 0, h: new Array(24).fill(0) });
  s[platform === "youtube" ? "yt" : "ig"]++;
  s.h[new Date(ts).getHours()]++;
}

// One-time: fold the raw events recorded by earlier versions into dailyStats
// so no existing history is lost. Idempotent via the statsBackfilled flag.
async function backfill() {
  const { statsBackfilled, dailyStats, watchedShortform } = await storageGet({
    statsBackfilled: false,
    dailyStats: {},
    watchedShortform: [],
  });
  if (statsBackfilled) return;
  const stats = { ...dailyStats };
  const rebuilt = {};
  for (const e of watchedShortform) addToStats(rebuilt, e.platform, e.ts);
  for (const [k, v] of Object.entries(rebuilt)) if (!stats[k]) stats[k] = v;
  await storageSet({ dailyStats: stats, statsBackfilled: true });
}
const ready = backfill();

// Serialize record operations so two tabs firing at once can't lose writes.
let recordChain = Promise.resolve();

// A watch event is just "one swipe-up on <platform>" — no video ids stored.
function recordWatch(platform) {
  recordChain = recordChain.then(async () => {
    await ready;
    const { watchedShortform, dailyStats } = await storageGet({
      watchedShortform: [],
      dailyStats: {},
    });
    const now = Date.now();
    const entries = watchedShortform.filter((e) => e.ts > now - RAW_KEEP_MS);
    entries.push({ platform, ts: now });
    addToStats(dailyStats, platform, now);
    await storageSet({ watchedShortform: entries, dailyStats });
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
