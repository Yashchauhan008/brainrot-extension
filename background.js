// Brain Rot Counter — background service worker.
// Owns all state (auth, local 24h window, server outbox) so counting is
// race-free across tabs, and does all network calls (content scripts are
// blocked by page CSP on Instagram/YouTube).

const API_URL = "https://api.brainrot.quicklabs.pro";
const PORTAL_URL = "https://brainrot.quicklabs.pro";
// Local development:
// const API_URL = "http://localhost:3017";
// const PORTAL_URL = "http://localhost:3010";

const DAY_MS = 24 * 60 * 60 * 1000;
const FLUSH_ALARM = "brc-flush-outbox";
const SETTINGS_ALARM = "brc-sync-settings";

// Mirrors the server's DEFAULT_SETTINGS — used until the first successful sync.
const DEFAULT_SETTINGS = {
  rot_icon_enabled: true,
  screen_fade_enabled: true,
  milestone_popups_enabled: true,
  hard_block_enabled: false,
  daily_target: 50,
};

// ---------- storage helpers ----------

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function pruneWindow(entries) {
  const cutoff = Date.now() - DAY_MS;
  return entries.filter((e) => e.ts > cutoff);
}

// ---------- watch recording ----------

// Serialize record operations so two tabs firing at once can't lose writes.
let recordChain = Promise.resolve();

// A watch event is just "one swipe-up on <platform>" — no video ids are
// read, stored or uploaded. The random client_event_id only makes retried
// batches idempotent.
function recordWatch(platform) {
  recordChain = recordChain.then(async () => {
    const { watchedShortform, outbox, auth } = await storageGet({
      watchedShortform: [],
      outbox: [],
      auth: null,
    });

    const entries = pruneWindow(watchedShortform);
    entries.push({ platform, ts: Date.now() });
    outbox.push({
      platform,
      client_event_id: crypto.randomUUID(),
      watched_at: new Date().toISOString(),
    });

    await storageSet({ watchedShortform: entries, outbox });

    if (auth) flushOutbox();
  });
  return recordChain;
}

// ---------- server sync ----------

// Access tokens are short-lived; on 401 we rotate via the refresh token.
async function refreshAuth() {
  const { auth } = await storageGet({ auth: null });
  if (!auth || !auth.refresh_token) {
    await storageSet({ auth: null }); // no way back — lock the bubble
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: auth.refresh_token }),
    });

    if (!response.ok) {
      // Refresh token dead (expired/revoked/reused) — require re-login.
      await storageSet({ auth: null });
      return null;
    }

    const data = await response.json();
    const next = {
      token: data.token,
      refresh_token: data.refresh_token,
      user: data.user || auth.user,
    };
    await storageSet({ auth: next });
    return next;
  } catch (_) {
    return null; // network down — keep auth, retry later
  }
}

let flushing = false;

async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const { auth, outbox } = await storageGet({ auth: null, outbox: [] });
    if (!auth || outbox.length === 0) return;

    const batch = outbox.slice(0, 100);

    const send = (token) =>
      fetch(`${API_URL}/events/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ events: batch }),
      });

    let response = await send(auth.token);

    if (response.status === 401) {
      const refreshed = await refreshAuth();
      if (!refreshed) return; // outbox is kept for after re-login
      response = await send(refreshed.token);
    }

    if (!response.ok) return; // server error — retry on next alarm

    // Remove exactly what we sent; new events may have arrived meanwhile.
    const { outbox: current } = await storageGet({ outbox: [] });
    await storageSet({ outbox: current.slice(batch.length) });
  } catch (_) {
    // Network down — outbox stays, next alarm retries.
  } finally {
    flushing = false;
  }
}

// ---------- settings sync ----------

// Pulls the user's effect toggles (rot icon / screen fade / milestone popups /
// daily target) from the server into storage; content scripts react to changes.
async function syncSettings() {
  const { auth } = await storageGet({ auth: null });
  if (!auth) return;

  const get = (token) =>
    fetch(`${API_URL}/users/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  try {
    let response = await get(auth.token);

    if (response.status === 401) {
      const refreshed = await refreshAuth();
      if (!refreshed) return;
      response = await get(refreshed.token);
    }

    if (!response.ok) return; // server error — next alarm retries

    const data = await response.json();
    await storageSet({ settings: { ...DEFAULT_SETTINGS, ...data.settings } });
  } catch (_) {
    // Network down — keep whatever settings we already have.
  }
}

// ---------- friends ----------

// Fetched on demand when a bubble is double-clicked (content scripts can't
// call the API themselves — page CSP).
async function fetchFriends() {
  const { auth } = await storageGet({ auth: null });
  if (!auth) return { ok: false };

  const get = (token) =>
    fetch(`${API_URL}/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  try {
    let response = await get(auth.token);

    if (response.status === 401) {
      const refreshed = await refreshAuth();
      if (!refreshed) return { ok: false };
      response = await get(refreshed.token);
    }

    if (!response.ok) return { ok: false };

    const data = await response.json();
    return { ok: true, me: data.me, friends: data.friends };
  } catch (_) {
    return { ok: false };
  }
}

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.create(SETTINGS_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushOutbox();
  if (alarm.name === SETTINGS_ALARM) syncSettings();
});

// Fresh settings whenever the worker wakes up.
syncSettings();

// ---------- self-heal after reload/update ----------

// Chrome does NOT re-inject content scripts into tabs that were already open
// when the extension is reloaded — those tabs keep a dead script until a
// manual refresh. Re-inject into every matching open tab so effects (hard
// block, fade, rot icon) work immediately after every update.
const SITE_URLS = [
  "https://www.instagram.com/*",
  "https://www.youtube.com/*",
  "https://m.youtube.com/*",
];
const PORTAL_URLS = ["https://brainrot.quicklabs.pro/*", "http://localhost:3010/*"];

// Bump when locally stored counters become invalid (e.g. the extension now
// talks to the production server — counts from local testing are stale).
const DATA_VERSION = 2;

async function resetLocalCounters(extra = {}) {
  await storageSet({
    watchedShortform: [],
    outbox: [],
    milestoneState: null,
    ...extra,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { dataVersion } = await storageGet({ dataVersion: 0 });
  if (dataVersion < DATA_VERSION) {
    await resetLocalCounters({ dataVersion: DATA_VERSION });
  }

  const inject = async (urls, files, css) => {
    const tabs = await chrome.tabs.query({ url: urls });
    for (const tab of tabs) {
      try {
        if (css)
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: css });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      } catch (_) {
        // chrome:// previews, discarded tabs etc. — skip
      }
    }
  };

  await inject(SITE_URLS, ["content.js"], ["popup.css"]);
  await inject(PORTAL_URLS, ["connect.js"], null);
});

// ---------- messages ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "WATCH_EVENT":
      recordWatch(message.platform).then(() => sendResponse({ ok: true }));
      return true;

    case "SET_TOKEN":
      storageGet({ auth: null }).then(async ({ auth }) => {
        // Different account than before — its counts (and queued events)
        // belong to the old user, don't leak them into this one.
        const prevUserId = auth?.user?.id;
        const nextUserId = message.user?.id;
        if (prevUserId && nextUserId && prevUserId !== nextUserId) {
          await resetLocalCounters();
        }

        await storageSet({
          auth: {
            token: message.token,
            refresh_token: message.refresh_token || null,
            user: message.user,
          },
        });
        flushOutbox();
        syncSettings();
        sendResponse({ ok: true });
      });
      return true;

    case "CLEAR_TOKEN":
      storageSet({ auth: null }).then(() => sendResponse({ ok: true }));
      return true;

    // Instant settings push from the portal (via connect.js) — storage
    // change fans out to every open Instagram/YouTube tab immediately.
    case "SET_SETTINGS":
      storageSet({ settings: { ...DEFAULT_SETTINGS, ...message.settings } }).then(
        () => sendResponse({ ok: true }),
      );
      return true;

    case "GET_AUTH":
      storageGet({ auth: null }).then(({ auth }) =>
        sendResponse({ auth: auth ? { user: auth.user } : null }),
      );
      return true;

    case "GET_FRIENDS":
      fetchFriends().then(sendResponse);
      return true;

    case "OPEN_PORTAL":
      chrome.tabs.create({
        url: `${PORTAL_URL}${message.path || "/login?from=extension"}`,
      });
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});
