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
function dayBuckets(n) {
  const today = startOfDay(Date.now());
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = today - i * DAY;
    days.push({ start, ig: 0, yt: 0 });
  }
  for (const e of log) {
    const idx = Math.floor((startOfDay(e.ts) - days[0].start) / DAY);
    if (idx >= 0 && idx < n) days[idx][e.platform === "youtube" ? "yt" : "ig"]++;
  }
  return days;
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const fmtHour = (h) => {
  const f = (x) => ((x + 11) % 12 + 1) + (x % 24 < 12 ? "am" : "pm");
  return f(h) + "–" + f((h + 1) % 24);
};

// Bar with a rounded top (data end); bottom stays square on the baseline.
function barPath(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderChart(days) {
  const W = 306, H = 150, padL = 22, padB = 16, padT = 8;
  const plotW = W - padL, plotH = H - padB - padT;
  const max = Math.max(5, ...days.map((d) => d.ig + d.yt));
  const niceMax = Math.ceil(max / 10) * 10;
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  const slot = plotW / days.length;
  const bw = Math.min(28, slot * 0.62);
  const target = settings.daily_target;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily Reels and Shorts counts">`;
  for (const v of [0, niceMax / 2, niceMax]) {
    svg += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  }
  if (target <= niceMax) {
    svg += `<line x1="${padL}" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="4 3"/>`;
    svg += `<text x="${W}" y="${y(target) - 3}" text-anchor="end" style="fill:var(--danger)">target ${target}</text>`;
  }
  days.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const x = cx - bw / 2;
    const base = y(0);
    const hIg = (d.ig / niceMax) * plotH;
    const hYt = (d.yt / niceMax) * plotH;
    const gap = d.ig && d.yt ? 2 : 0; // 2px surface gap between stacked fills
    if (d.ig) svg += `<path d="${barPath(x, base - hIg, bw, hIg, d.yt ? 0 : 4)}" fill="var(--ig)"/>`;
    if (d.yt) svg += `<path d="${barPath(x, base - hIg - hYt - gap, bw, hYt, 4)}" fill="var(--yt)"/>`;
    const label = days.length <= 7
      ? new Date(d.start).toLocaleDateString([], { weekday: "short" })
      : (i % 7 === days.length % 7 || i === days.length - 1) ? new Date(d.start).getDate() : "";
    if (label !== "") svg += `<text x="${cx}" y="${H - 3}" text-anchor="middle">${label}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="0" width="${slot}" height="${H - padB}" fill="transparent"/>`;
  });
  svg += `</svg>`;
  $("chart").innerHTML = svg;

  const tip = $("tip");
  $("chart").querySelectorAll(".hit").forEach((r) => {
    r.addEventListener("mousemove", (ev) => {
      const d = days[Number(r.dataset.i)];
      tip.innerHTML = `<b>${fmtDate(d.start)}</b>Instagram ${d.ig}<br>YouTube ${d.yt}<br>Total ${d.ig + d.yt}`;
      tip.hidden = false;
      const box = $("chartWrap").getBoundingClientRect();
      const left = Math.min(box.width - tip.offsetWidth - 2, Math.max(2, ev.clientX - box.left + 10));
      tip.style.left = left + "px";
      tip.style.top = Math.max(0, ev.clientY - box.top - tip.offsetHeight - 8) + "px";
    });
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

function renderTable(days) {
  const rows = [...days].reverse().map((d) =>
    `<tr><td>${fmtDate(d.start)}</td><td>${d.ig}</td><td>${d.yt}</td><td>${d.ig + d.yt}</td></tr>`).join("");
  $("table").innerHTML = `<thead><tr><th>Day</th><th>IG</th><th>YT</th><th>Total</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderInsights() {
  const days = dayBuckets(rangeDays);
  const totals = days.map((d) => d.ig + d.yt);
  const target = Math.max(1, settings.daily_target);

  $("lgIg").textContent = days.reduce((a, d) => a + d.ig, 0);
  $("lgYt").textContent = days.reduce((a, d) => a + d.yt, 0);
  renderChart(days);
  renderTable(days);

  // Only count days since the first recorded swipe, so empty pre-install days
  // don't flatter the averages or the streak.
  const firstTs = log.length ? Math.min(...log.map((e) => e.ts)) : Date.now();
  const firstIdx = Math.max(0, Math.floor((startOfDay(firstTs) - days[0].start) / DAY));
  const live = days.slice(firstIdx);
  const sum = live.reduce((a, d) => a + d.ig + d.yt, 0);

  $("tAvg").textContent = log.length ? Math.round(sum / live.length) : "–";
  const heaviest = live.reduce((m, d) => (d.ig + d.yt > m.v ? { v: d.ig + d.yt, d } : m), { v: -1, d: null });
  $("tMax").textContent = log.length && heaviest.v > 0 ? `${heaviest.v}` : "–";
  $("tMax").title = heaviest.d ? fmtDate(heaviest.d.start) : "";

  let streak = 0;
  for (let i = days.length - 1; i >= firstIdx; i--) {
    if (totals[i] <= target) streak++; else break;
  }
  $("tStreak").textContent = log.length ? `${streak} day${streak === 1 ? "" : "s"}` : "–";

  const rangeStart = days[0].start;
  const hours = new Array(24).fill(0);
  log.filter((e) => e.ts >= rangeStart).forEach((e) => hours[new Date(e.ts).getHours()]++);
  const peak = Math.max(...hours);
  $("tPeak").textContent = peak > 0 ? fmtHour(hours.indexOf(peak)) : "–";

  const mins = Math.round((sum * SEC_PER_VIDEO) / 60);
  $("estimate").textContent = sum
    ? `≈ ${mins} min over ${rangeDays} days (estimate at ~${SEC_PER_VIDEO}s per video)`
    : "No swipes recorded yet.";
}

// ---------- init ----------
(async () => {
  const stored = await new Promise((r) =>
    chrome.storage.local.get({ settings: null, watchedShortform: [] }, r));
  settings = { ...DEFAULTS, ...(stored.settings || {}) };
  log = stored.watchedShortform;

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
