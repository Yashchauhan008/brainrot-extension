// Focus Meter popup — all state lives in chrome.storage.local.
const DEFAULTS = {
  rot_icon_enabled: true,
  screen_fade_enabled: true,
  milestone_popups_enabled: true,
  hard_block_enabled: false,
  daily_target: 50,
  manual_block_until: 0,
  schedule_enabled: false,
  schedule_start: "22:00",
  schedule_end: "06:00",
};
const FOREVER_MS = 10 * 365 * 24 * 3600 * 1000;
const UNBLOCK_WAIT_S = 30; // friction: a short cooling-off before early unblock

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };
let countdown = null;

const load = () => new Promise((r) => chrome.storage.local.get({ settings: null, watchedShortform: [] }, r));

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.local.set({ settings });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function renderStatus() {
  const active = Date.now() < settings.manual_block_until;
  $("blockButtons").hidden = active;
  $("unblockRow").hidden = !active;
  const status = $("status");
  status.classList.toggle("on", active);
  if (!active) {
    status.textContent = "Not blocking — block on command:";
    return;
  }
  const until = settings.manual_block_until;
  status.textContent =
    until > Date.now() + FOREVER_MS / 2
      ? "🚫 Blocked until you unblock"
      : "🚫 Blocked until " + new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function block(kind) {
  let until;
  if (kind === "forever") until = Date.now() + FOREVER_MS;
  else if (kind === "midnight") {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    until = d.getTime();
  } else until = Date.now() + Number(kind) * 60 * 1000;
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
    if (left > 0) {
      btn.textContent = `Wait ${left}s…`;
      return;
    }
    clearInterval(countdown);
    countdown = null;
    btn.disabled = false;
    btn.textContent = "Unblock";
    save({ manual_block_until: 0 });
    renderStatus();
  }, 1000);
}

(async () => {
  const stored = await load();
  settings = { ...DEFAULTS, ...(stored.settings || {}) };

  const todays = stored.watchedShortform.filter((e) => e.ts >= startOfToday());
  const ig = todays.filter((e) => e.platform === "instagram").length;
  const yt = todays.filter((e) => e.platform === "youtube").length;
  $("count").textContent = todays.length;
  $("breakdown").textContent = `today · Instagram ${ig} · YouTube ${yt}`;

  $("target").value = settings.daily_target;
  $("hard").checked = settings.hard_block_enabled;
  $("rot").checked = settings.rot_icon_enabled;
  $("fade").checked = settings.screen_fade_enabled;
  $("milestones").checked = settings.milestone_popups_enabled;

  $("target").addEventListener("change", (e) =>
    save({ daily_target: Math.max(1, Number(e.target.value) || 50) }));
  $("hard").addEventListener("change", (e) => save({ hard_block_enabled: e.target.checked }));
  $("rot").addEventListener("change", (e) => save({ rot_icon_enabled: e.target.checked }));
  $("fade").addEventListener("change", (e) => save({ screen_fade_enabled: e.target.checked }));
  $("milestones").addEventListener("change", (e) => save({ milestone_popups_enabled: e.target.checked }));

  $("sched").checked = settings.schedule_enabled;
  $("schedStart").value = settings.schedule_start;
  $("schedEnd").value = settings.schedule_end;
  $("sched").addEventListener("change", (e) => save({ schedule_enabled: e.target.checked }));
  $("schedStart").addEventListener("change", (e) => save({ schedule_start: e.target.value || "22:00" }));
  $("schedEnd").addEventListener("change", (e) => save({ schedule_end: e.target.value || "06:00" }));

  $("blockButtons").addEventListener("click", (e) => {
    const kind = e.target.dataset?.min;
    if (kind) block(kind);
  });
  $("unblock").addEventListener("click", unblock);

  renderStatus();
})();
