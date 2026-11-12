// Focus Meter popup — tabs: Focus (block + today), Insights (analytics), Settings.
// All state lives in chrome.storage.local; nothing leaves the device.
const DEFAULTS = {
  rot_icon_enabled: true,
  screen_fade_enabled: true,
  milestone_popups_enabled: true,
  hard_block_enabled: false,
  daily_target: 50,
  manual_block_until: 0,
  block_feed_videos: false,
  schedule_enabled: false,
  schedule_start: "22:00",
  schedule_end: "06:00",
};
const FOREVER_MS = 10 * 365 * 24 * 3600 * 1000;
const UNBLOCK_WAIT_S = 30;
const SEC_PER_VIDEO = 30; // rough guess, shown as an estimate only
const DAY = 24 * 3600 * 1000;

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };
let log = [];
let dailyStats = {};
let rangeDays = 7;
let countdown = null;

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.local.set({ settings });
}

const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  try { localStorage.setItem("fm-tab", name); } catch (_) {}
  if (name === "insights") renderInsights();
}

// ---------- focus tab ----------
function renderToday() {
  const today = log.filter((e) => e.ts >= startOfDay(Date.now()));
  const ig = today.filter((e) => e.platform === "instagram").length;
  const yt = today.filter((e) => e.platform === "youtube").length;
  const target = Math.max(1, settings.daily_target);
  $("count").textContent = today.length;
  $("breakdown").textContent = `Instagram ${ig} · YouTube ${yt}`;
  $("targetPill").textContent = `of ${target}`;
  const fill = $("meterFill");
  fill.style.width = Math.min(100, (today.length / target) * 100) + "%";
  fill.classList.toggle("over", today.length >= target);
}

function renderStatus() {
  const active = Date.now() < settings.manual_block_until;
  $("blockButtons").hidden = active;
  $("unblockRow").hidden = !active;
  const status = $("status");
  status.classList.toggle("on", active);
  if (!active) { status.textContent = "Not blocking — block on command:"; return; }
  const until = settings.manual_block_until;
  status.textContent = until > Date.now() + FOREVER_MS / 2
    ? "🚫 Blocked until you unblock"
    : "🚫 Blocked until " + new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function block(kind) {
  let until;
  if (kind === "forever") until = Date.now() + FOREVER_MS;
  else if (kind === "midnight") { const d = new Date(); d.setHours(24, 0, 0, 0); until = d.getTime(); }
  else until = Date.now() + Number(kind) * 60 * 1000;
  save({ manual_block_until: until });
  renderStatus();
}

function unblock() {
  const btn = $("unblock");
  if (countdown) return;
  let left = UNBLOCK_WAIT_S;
  btn.disabled = true;
  btn.textContent = `Wait ${left}s…`;
  countdown = setInterval(() => {
    left -= 1;
    if (left > 0) { btn.textContent = `Wait ${left}s…`; return; }
    clearInterval(countdown);
    countdown = null;
    btn.disabled = false;
    btn.textContent = "Unblock";
    save({ manual_block_until: 0 });
    renderStatus();
  }, 1000);
}

// ---------- insights ----------
const keyOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Lifetime stats = dailyStats (kept forever) plus any raw events for days the
// background worker hasn't folded in yet (right after an update).
function allStats() {
  const stats = { ...dailyStats };
  const raw = {};
  for (const e of log) {
    const k = keyOf(e.ts);
    if (stats[k]) continue;
    const s = raw[k] || (raw[k] = { ig: 0, yt: 0, h: new Array(24).fill(0) });
    s[e.platform === "youtube" ? "yt" : "ig"]++;
    s.h[new Date(e.ts).getHours()]++;
  }
  return { ...stats, ...raw };
}

// One row per calendar day for the last n days (oldest first).
function dailyRows(stats, n) {
  const today = startOfDay(Date.now());
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const s = stats[keyOf(start.getTime())];
    rows.push({ start: start.getTime(), ig: s?.ig || 0, yt: s?.yt || 0, h: s?.h || null });
  }
  return rows;
}

// Long ranges are grouped (weeks, then months) so bars stay readable.
function bucketRows(rows) {
  const size = rows.length <= 45 ? 1 : rows.length <= 200 ? 7 : 30;
  if (size === 1) return { size, buckets: rows };
  const buckets = [];
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    buckets.push({
      start: part[0].start,
      ig: part.reduce((a, r) => a + r.ig, 0),
      yt: part.reduce((a, r) => a + r.yt, 0),
      days: part.length,
    });
  }
  return { size, buckets };
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const fmtHour = (h) => {
  const f = (x) => ((x + 11) % 12 + 1) + (x % 24 < 12 ? "am" : "pm");
  return f(h) + "–" + f((h + 1) % 24);
};

// Bar with a rounded top (data end); bottom stays square on the baseline.
function barPath(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderChart(buckets, size) {
  const W = 306, H = 150, padL = 26, padB = 16, padT = 8;
  const plotW = W - padL, plotH = H - padB - padT;
  const perBucketTarget = Math.max(1, settings.daily_target) * size;
  const max = Math.max(5, ...buckets.map((d) => d.ig + d.yt));
  const niceMax = Math.ceil(max / 10) * 10;
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  const slot = plotW / buckets.length;
  const bw = Math.max(2, Math.min(28, slot * 0.62));
  const unit = size === 1 ? "day" : size === 7 ? "week" : "month";

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Reels and Shorts per ${unit}">`;
  for (const v of [0, niceMax / 2, niceMax]) {
    svg += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  }
  if (perBucketTarget <= niceMax) {
    svg += `<line x1="${padL}" x2="${W}" y1="${y(perBucketTarget)}" y2="${y(perBucketTarget)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="4 3"/>`;
    if (y(perBucketTarget) - padT > 12) // skip the label if it would collide with the top tick
      svg += `<text x="${W}" y="${y(perBucketTarget) - 3}" text-anchor="end" style="fill:var(--danger)">target ${perBucketTarget}</text>`;
  }
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));
  buckets.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const x = cx - bw / 2;
    const base = y(0);
    const hIg = (d.ig / niceMax) * plotH;
    const hYt = (d.yt / niceMax) * plotH;
    const gap = d.ig && d.yt ? 2 : 0; // 2px surface gap between stacked fills
    if (d.ig) svg += `<path d="${barPath(x, base - hIg, bw, hIg, d.yt ? 0 : 4)}" fill="var(--ig)"/>`;
    if (d.yt) svg += `<path d="${barPath(x, base - hIg - hYt - gap, bw, hYt, 4)}" fill="var(--yt)"/>`;
    if (i % labelEvery === 0) {
      const dt = new Date(d.start);
      const label = size === 1 && buckets.length <= 7
        ? dt.toLocaleDateString([], { weekday: "short" })
        : size === 30 ? dt.toLocaleDateString([], { month: "short" })
        : `${dt.getDate()}/${dt.getMonth() + 1}`;
      svg += `<text x="${cx}" y="${H - 3}" text-anchor="middle">${label}</text>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="0" width="${slot}" height="${H - padB}" fill="transparent"/>`;
  });
  svg += `</svg>`;
  $("chart").innerHTML = svg;

  const tip = $("tip");
  $("chart").querySelectorAll(".hit").forEach((r) => {
    r.addEventListener("mousemove", (ev) => {
      const d = buckets[Number(r.dataset.i)];
      const head = size === 1 ? fmtDate(d.start) : `${unit === "week" ? "Week" : "Month"} of ${fmtDay(d.start)}`;
      tip.innerHTML = `<b>${head}</b>Instagram ${d.ig}<br>YouTube ${d.yt}<br>Total ${d.ig + d.yt}`;
      tip.hidden = false;
      const box = $("chartWrap").getBoundingClientRect();
      const left = Math.min(box.width - tip.offsetWidth - 2, Math.max(2, ev.clientX - box.left + 10));
      tip.style.left = left + "px";
      tip.style.top = Math.max(0, ev.clientY - box.top - tip.offsetHeight - 8) + "px";
    });
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

function renderTable(buckets, size) {
  const rows = [...buckets].reverse().map((d) =>
    `<tr><td>${size === 1 ? fmtDate(d.start) : fmtDay(d.start)}</td><td>${d.ig}</td><td>${d.yt}</td><td>${d.ig + d.yt}</td></tr>`).join("");
  $("table").innerHTML = `<thead><tr><th>${size === 1 ? "Day" : size === 7 ? "Week of" : "Month of"}</th><th>IG</th><th>YT</th><th>Total</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderInsights() {
  const stats = allStats();
  const keys = Object.keys(stats).sort();
  const hasData = keys.length > 0;
  const firstDay = hasData ? new Date(keys[0] + "T00:00:00").getTime() : startOfDay(Date.now());
  const sinceFirst = Math.round((startOfDay(Date.now()) - firstDay) / DAY) + 1;

  const n = rangeDays === 0 ? Math.max(7, sinceFirst) : rangeDays;
  const rows = dailyRows(stats, n);
  const { size, buckets } = bucketRows(rows);
  const target = Math.max(1, settings.daily_target);

  $("lgIg").textContent = rows.reduce((a, d) => a + d.ig, 0);
  $("lgYt").textContent = rows.reduce((a, d) => a + d.yt, 0);
  renderChart(buckets, size);
  renderTable(buckets, size);

  // Only count days since the first recorded swipe, so empty pre-install days
  // don't flatter the averages or the streak.
  const live = rows.filter((r) => r.start >= firstDay);
  const sum = live.reduce((a, d) => a + d.ig + d.yt, 0);

  $("tAvg").textContent = hasData ? Math.round(sum / live.length) : "–";
  const heaviest = live.reduce((m, d) => (d.ig + d.yt > m.v ? { v: d.ig + d.yt, d } : m), { v: -1, d: null });
  $("tMax").textContent = hasData && heaviest.v > 0 ? `${heaviest.v}` : "–";
  $("tMax").title = heaviest.d ? fmtDate(heaviest.d.start) : "";

  // Streak is always measured over full lifetime, not the chart range.
  const full = dailyRows(stats, Math.max(1, sinceFirst));
  let streak = 0;
  for (let i = full.length - 1; i >= 0; i--) {
    if (full[i].ig + full[i].yt <= target) streak++; else break;
  }
  $("tStreak").textContent = hasData ? `${streak} day${streak === 1 ? "" : "s"}` : "–";

  const hours = new Array(24).fill(0);
  rows.forEach((r) => r.h && r.h.forEach((c, i) => (hours[i] += c)));
  const peak = Math.max(...hours);
  $("tPeak").textContent = peak > 0 ? fmtHour(hours.indexOf(peak)) : "–";

  const life = full.reduce((a, d) => a + d.ig + d.yt, 0);
  $("estimate").textContent = hasData
    ? `Lifetime: ${life.toLocaleString()} videos since ${fmtDay(firstDay)} · ≈ ${Math.round((life * SEC_PER_VIDEO) / 3600 * 10) / 10} h (est. ~${SEC_PER_VIDEO}s each)`
    : "No swipes recorded yet.";
}

// ---------- export / import ----------
function exportData() {
  const payload = { app: "focus-meter", version: 1, exported: new Date().toISOString(), dailyStats: allStats() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `focus-meter-${keyOf(Date.now())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (incoming.app !== "focus-meter" || typeof incoming.dailyStats !== "object") throw new Error("bad file");
      // Per day keep whichever side recorded more (safe to import repeatedly).
      const merged = { ...allStats() };
      for (const [k, v] of Object.entries(incoming.dailyStats)) {
        const cur = merged[k];
        if (!cur || v.ig + v.yt > cur.ig + cur.yt) merged[k] = v;
      }
      dailyStats = merged;
      chrome.storage.local.set({ dailyStats: merged, statsBackfilled: true });
      $("dataMsg").textContent = `Imported ${Object.keys(incoming.dailyStats).length} days.`;
    } catch (_) {
      $("dataMsg").textContent = "That doesn't look like a Focus Meter export.";
    }
  };
  reader.readAsText(file);
}

// ---------- init ----------
(async () => {
  const stored = await new Promise((r) =>
    chrome.storage.local.get({ settings: null, watchedShortform: [], dailyStats: {} }, r));
  settings = { ...DEFAULTS, ...(stored.settings || {}) };
  log = stored.watchedShortform;
  dailyStats = stored.dailyStats;

  renderToday();
  renderStatus();

  const map = { hard: "hard_block_enabled", rot: "rot_icon_enabled", fade: "screen_fade_enabled",
    milestones: "milestone_popups_enabled", feedVideos: "block_feed_videos", sched: "schedule_enabled" };
  for (const [id, key] of Object.entries(map)) {
    $(id).checked = Boolean(settings[key]);
    $(id).addEventListener("change", (e) => { save({ [key]: e.target.checked }); renderToday(); });
  }
  $("target").value = settings.daily_target;
  $("target").addEventListener("change", (e) => {
    save({ daily_target: Math.max(1, Number(e.target.value) || 50) });
    renderToday();
  });
  $("schedStart").value = settings.schedule_start;
  $("schedEnd").value = settings.schedule_end;
  $("schedStart").addEventListener("change", (e) => save({ schedule_start: e.target.value || "22:00" }));
  $("schedEnd").addEventListener("change", (e) => save({ schedule_end: e.target.value || "06:00" }));

  $("blockButtons").addEventListener("click", (e) => { if (e.target.dataset?.min) block(e.target.dataset.min); });
  $("unblock").addEventListener("click", unblock);

  $("tabs").addEventListener("click", (e) => { if (e.target.dataset?.tab) showTab(e.target.dataset.tab); });
  $("range").addEventListener("click", (e) => {
    if (!e.target.dataset?.days) return;
    rangeDays = Number(e.target.dataset.days);
    document.querySelectorAll("#range button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b === e.target)));
    renderInsights();
  });
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => e.target.files[0] && importData(e.target.files[0]));
  $("tableBtn").addEventListener("click", () => {
    const on = $("table").hidden;
    $("table").hidden = !on;
    $("chartWrap").hidden = on;
    $("tableBtn").textContent = on ? "Chart" : "Table";
  });

  let tab = "focus";
  try { tab = localStorage.getItem("fm-tab") || "focus"; } catch (_) {}
  showTab(tab);
})();
