// Brain Rot Counter — content script for instagram.com / youtube.com.
// Detects reels/shorts, reports them to the background worker, and renders
// the floating brain bubble (login-gated, merged 24h count, live across tabs)
// plus the "rot" effects: staged icon decay, screen fade past the daily
// target, and milestone popups. Effects are user-toggleable (portal settings,
// synced to chrome.storage by the background worker).

(() => {
  // The background worker re-injects into open tabs after an extension
  // reload — don't run twice if this tab already has a live copy.
  if (window.__brainrotLoaded) return;
  window.__brainrotLoaded = true;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const POLL_MS = 500;

  // Mirrors the server's DEFAULT_SETTINGS — used until the first sync lands.
  const DEFAULT_SETTINGS = {
    rot_icon_enabled: true,
    screen_fade_enabled: true,
    milestone_popups_enabled: true,
    hard_block_enabled: false,
    daily_target: 50,
  };

  let bubble = null;
  let brainEl = null;
  let countEl = null;
  let loginBtn = null;
  let fadeEl = null;
  let blockerEl = null;
  let blockerActive = false;
  let milestoneEl = null;
  let milestoneTimer = null;
  let friendsEl = null;
  let loggedIn = false;
  let settings = { ...DEFAULT_SETTINGS };
  let lastVideoKey = null;
  let keyStack = []; // recent reel keys, in-memory only, for back-swipe detection
  let onVideoPage = false;
  let renderedStage = -1;
  let lastCount = 0;

  // ---------- URL detection ----------

  // Returns {platform, videoId} when the current URL is a reel/short.
  // The id stays in this tab's memory, only to tell a swipe-up apart from a
  // back-swipe — it is never stored and never sent anywhere.
  function currentVideo() {
    const { hostname, pathname } = location;

    if (hostname.includes("instagram.com")) {
      const m = pathname.match(/^\/reels?\/([^/]+)/);
      if (m && m[1] !== "audio") return { platform: "instagram", videoId: m[1] };
      return null;
    }

    if (hostname.includes("youtube.com")) {
      const m = pathname.match(/^\/shorts\/([^/]+)/);
      if (m) return { platform: "youtube", videoId: m[1] };
      return null;
    }

    return null;
  }

  // ---------- rotting brain icon ----------

  // Stage 0 = healthy pink … stage 3 = fully decayed. Each stage darkens the
  // hemispheres and layers on decay details (spots, cracks, a drip).
  const ROT_STAGES = [
    { left: "#f48fb1", right: "#f8bbd0", stroke: "#ad1457", decor: "" },
    {
      left: "#cbe08a",
      right: "#dcedaa",
      stroke: "#7a8f2e",
      decor: `
        <circle cx="22" cy="26" r="2.5" fill="#7a8f2e" opacity=".55"/>
        <circle cx="44" cy="21" r="2" fill="#7a8f2e" opacity=".55"/>`,
    },
    {
      left: "#a3b55e",
      right: "#b8c774",
      stroke: "#5a6b1f",
      decor: `
        <circle cx="22" cy="26" r="3" fill="#5a6b1f" opacity=".6"/>
        <circle cx="44" cy="21" r="2.5" fill="#5a6b1f" opacity=".6"/>
        <circle cx="38" cy="40" r="2" fill="#5a6b1f" opacity=".6"/>
        <path d="M20 18l3 6-2 6" fill="none" stroke="#4b5320" stroke-width="2" stroke-linecap="round"/>`,
    },
    {
      left: "#8a7a5c",
      right: "#9c8d70",
      stroke: "#4e3b2a",
      decor: `
        <circle cx="22" cy="26" r="3" fill="#3e2f20" opacity=".7"/>
        <circle cx="44" cy="21" r="2.5" fill="#3e2f20" opacity=".7"/>
        <circle cx="38" cy="40" r="2.5" fill="#3e2f20" opacity=".7"/>
        <circle cx="26" cy="38" r="2" fill="#3e2f20" opacity=".7"/>
        <path d="M20 18l3 6-2 6" fill="none" stroke="#3e2f20" stroke-width="2" stroke-linecap="round"/>
        <path d="M44 30l-3 5 2 5" fill="none" stroke="#3e2f20" stroke-width="2" stroke-linecap="round"/>
        <path d="M27 51q1.5 5 0 8" fill="none" stroke="#4e3b2a" stroke-width="3" stroke-linecap="round"/>`,
    },
  ];

  function brainSvg(stage) {
    const s = ROT_STAGES[stage];
    return `
    <svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
      <path fill="${s.left}" stroke="${s.stroke}" stroke-width="2" stroke-linejoin="round"
        d="M24 8c-5 0-8 3-9 6-4 1-7 4-7 8 0 2 .6 3.7 1.6 5C7 28.6 6 31 6 34c0 4 2.5 7 6 8.3.4 4.6 4 7.7 8.5 7.7 1.6 0 3.1-.4 4.4-1.2A8 8 0 0 0 32 52V12a8 8 0 0 0-8-4z"/>
      <path fill="${s.right}" stroke="${s.stroke}" stroke-width="2" stroke-linejoin="round"
        d="M40 8c5 0 8 3 9 6 4 1 7 4 7 8 0 2-.6 3.7-1.6 5C57 28.6 58 31 58 34c0 4-2.5 7-6 8.3-.4 4.6-4 7.7-8.5 7.7-1.6 0-3.1-.4-4.4-1.2A8 8 0 0 1 32 52V12a8 8 0 0 1 8-4z"/>
      <path fill="none" stroke="${s.stroke}" stroke-width="2" stroke-linecap="round"
        d="M24 16c-3 1-4 3-4 5m18-5c3 1 4 3 4 5M20 30c-2 1-3 3-3 5m30-5c2 1 3 3 3 5M26 42c-2 .5-3 2-3 4m18-4c2 .5 3 2 3 4"/>
      ${s.decor}
    </svg>`;
  }

  function rotStage(count) {
    if (!loggedIn || !settings.rot_icon_enabled) return 0;
    const target = Math.max(1, settings.daily_target);
    return Math.min(3, Math.floor(count / target));
  }

  function renderBrain(count) {
    if (!brainEl) return;
    const stage = rotStage(count);
    if (stage === renderedStage) return;
    renderedStage = stage;
    brainEl.innerHTML = brainSvg(stage);
  }

  // ---------- screen fade ----------

  // Past the daily target every extra video darkens the page a bit more:
  // +3.5% per video, capped at 88%. Only while actually on a reel/short.
  function ensureFade() {
    if (fadeEl && document.documentElement.contains(fadeEl)) return;
    fadeEl = document.createElement("div");
    fadeEl.id = "brainrot-rot-overlay";
    document.documentElement.appendChild(fadeEl);
  }

  function renderFade(count) {
    ensureFade();
    const target = Math.max(1, settings.daily_target);
    const over = count - target;
    const active =
      loggedIn && settings.screen_fade_enabled && onVideoPage && over > 0;
    fadeEl.style.opacity = active ? String(Math.min(0.88, over * 0.035)) : "0";
  }

  // ---------- hard block ----------

  // Once the 24h count reaches the daily target, reels/shorts are covered by
  // a full-screen wall: video paused, scroll/keys swallowed. Clears on its
  // own as the 24h window rolls (or when the toggle is turned off).
  function ensureBlocker() {
    if (blockerEl && document.documentElement.contains(blockerEl)) return;

    blockerEl = document.createElement("div");
    blockerEl.id = "brainrot-blocker";
    blockerEl.innerHTML = `
      <div class="brc-block-emoji">🧠🚫</div>
      <div class="brc-block-title">Daily limit reached</div>
      <div class="brc-block-text"></div>
      <div class="brc-block-hint">Comes back as your 24h window frees up.<br>Toggle "Hard block" off in the BrainRot portal to disable.</div>`;

    // Swallow every input that could scroll to the next reel.
    for (const type of ["wheel", "touchmove", "pointerdown", "click"]) {
      blockerEl.addEventListener(
        type,
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        { passive: false },
      );
    }

    document.documentElement.appendChild(blockerEl);
  }

  // Belt and suspenders: besides the overlay's own listeners, kill scroll /
  // swipe / key navigation at the window (capture phase) while blocked, so
  // the sites' own handlers never see them.
  const swallow = (e) => {
    if (!blockerActive) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("wheel", swallow, { capture: true, passive: false });
  window.addEventListener("touchmove", swallow, { capture: true, passive: false });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!blockerActive) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  function renderBlocker(count) {
    const target = Math.max(1, settings.daily_target);
    blockerActive =
      loggedIn && settings.hard_block_enabled && onVideoPage && count >= target;

    ensureBlocker();
    blockerEl.style.display = blockerActive ? "flex" : "none";

    if (blockerActive) {
      blockerEl.querySelector(".brc-block-text").textContent =
        `${count} brainrot videos in the last 24h — your limit is ${target}. Go touch grass 🌱`;
      silenceVideos();
    }
  }

  function silenceVideos() {
    document.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.muted = true;
    });
  }

  // ---------- milestone popups ----------

  // One popup each time the 24h count crosses another 2× the daily target
  // (default target 50 → popups at 100, 200, 300 …). The reached level is
  // stored so other tabs / reloads don't replay it; it resets with the window.
  const MILESTONE_LINES = [
    (n) => `🧠🪰 ${n} brainrot videos in 24h — your brain is officially compost`,
    (n) => `💀 ${n}?! the rot is terminal, seek grass immediately`,
    (n) => `🪦 ${n} videos. legends say you can still put the phone down`,
  ];

  function showMilestone(count, level) {
    if (milestoneTimer) {
      clearTimeout(milestoneTimer);
      milestoneEl?.remove();
    }

    milestoneEl = document.createElement("div");
    milestoneEl.id = "brainrot-milestone";
    milestoneEl.textContent =
      MILESTONE_LINES[Math.min(level - 1, MILESTONE_LINES.length - 1)](count);

    // Anchor just below the bubble, wherever the user dragged it.
    const rect = bubble?.getBoundingClientRect();
    if (rect) {
      milestoneEl.style.top = Math.min(window.innerHeight - 80, rect.bottom + 10) + "px";
      milestoneEl.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
    }

    document.documentElement.appendChild(milestoneEl);
    milestoneTimer = setTimeout(() => {
      milestoneEl?.remove();
      milestoneEl = null;
      milestoneTimer = null;
    }, 6000);
  }

  function maybeMilestone(count) {
    if (!loggedIn || !settings.milestone_popups_enabled) return;

    const step = 2 * Math.max(1, settings.daily_target);
    const level = Math.floor(count / step);
    if (level < 1) return;

    chrome.storage.local.get({ milestoneState: null }, ({ milestoneState }) => {
      const cutoff = Date.now() - DAY_MS;
      const known =
        milestoneState && milestoneState.ts > cutoff ? milestoneState.level : 0;
      if (level <= known) return;

      chrome.storage.local.set({ milestoneState: { level, ts: Date.now() } });
      showMilestone(count, level);
    });
  }

  // ---------- friends panel (double-click the bubble) ----------

  function positionNearBubble(el) {
    const rect = bubble?.getBoundingClientRect();
    if (!rect) return;
    el.style.top = Math.min(window.innerHeight - 120, rect.bottom + 10) + "px";
    el.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
  }

  function closeFriends() {
    friendsEl?.remove();
    friendsEl = null;
  }

  function renderFriendsList(data) {
    if (!friendsEl) return;
    const listEl = friendsEl.querySelector(".brc-friends-list");

    if (!data?.ok) {
      listEl.innerHTML = `<div class="brc-friends-empty">Couldn't load — is the server up?</div>`;
      return;
    }

    const everyone = [
      { ...data.me, name: "You" },
      ...(data.friends || []),
    ].sort((a, b) => a.today_total - b.today_total);

    if (everyone.length === 1) {
      listEl.innerHTML = `<div class="brc-friends-empty">No friends yet — invite them from the portal to compete.</div>`;
      return;
    }

    // Least brainrot today wins the crown.
    listEl.innerHTML = everyone
      .map((person, i) => {
        const name = document.createTextNode(person.name);
        const row = document.createElement("div");
        row.className = "brc-friends-row";
        const nameEl = document.createElement("span");
        nameEl.className = "brc-friends-name";
        nameEl.appendChild(name);
        row.appendChild(nameEl);
        row.insertAdjacentHTML(
          "beforeend",
          `<span class="brc-friends-count">${Number(person.today_total) || 0}</span>`,
        );
        if (i === 0) row.insertAdjacentHTML("afterbegin", `<span>👑</span>`);
        return row.outerHTML;
      })
      .join("");
  }

  function toggleFriends() {
    if (friendsEl) {
      closeFriends();
      return;
    }
    if (!loggedIn) return;

    friendsEl = document.createElement("div");
    friendsEl.id = "brainrot-friends";
    friendsEl.innerHTML = `
      <div class="brc-friends-title">Today's rot 🏆</div>
      <div class="brc-friends-list"><div class="brc-friends-empty">Loading…</div></div>
      <button class="brc-friends-portal" type="button">Open portal ↗</button>`;
    positionNearBubble(friendsEl);
    document.documentElement.appendChild(friendsEl);

    friendsEl.querySelector(".brc-friends-portal").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_PORTAL", path: "/friends" });
      closeFriends();
    });

    chrome.runtime.sendMessage({ type: "GET_FRIENDS" }, renderFriendsList);
  }

  // Any click outside the panel/bubble dismisses it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!friendsEl) return;
      if (friendsEl.contains(e.target) || bubble?.contains(e.target)) return;
      closeFriends();
    },
    true,
  );

  // ---------- floating bubble ----------

  function ensureBubble() {
    if (bubble && document.documentElement.contains(bubble)) return;

    bubble = document.createElement("div");
    bubble.id = "brainrot-counter-bubble";
    bubble.innerHTML = `
      <div class="brc-brain"></div>
      <span class="brc-count">–</span>
      <button class="brc-login" type="button">Login to track</button>`;
    brainEl = bubble.querySelector(".brc-brain");
    countEl = bubble.querySelector(".brc-count");
    loginBtn = bubble.querySelector(".brc-login");
    renderedStage = -1;
    renderBrain(lastCount);

    loginBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_PORTAL" });
    });

    bubble.addEventListener("dblclick", (e) => {
      if (e.target.closest(".brc-login")) return;
      e.preventDefault();
      toggleFriends();
    });

    document.documentElement.appendChild(bubble);
    makeDraggable(bubble);
  }

  function renderAuthState() {
    if (!bubble) return;
    bubble.classList.toggle("brc-locked", !loggedIn);
  }

  function setBubbleVisible(visible) {
    if (!bubble) {
      if (!visible) return;
      ensureBubble();
    }
    bubble.style.display = visible ? "flex" : "none";
  }

  function applyEffects(count) {
    lastCount = count;
    renderBrain(count);
    renderFade(count);
    renderBlocker(count);
    maybeMilestone(count);
  }

  function updateCount() {
    chrome.storage.local.get({ watchedShortform: [] }, ({ watchedShortform }) => {
      if (!countEl) return;
      const cutoff = Date.now() - DAY_MS;
      const count = watchedShortform.filter((e) => e.ts > cutoff).length;
      countEl.textContent = String(count);
      countEl.classList.remove("brc-pulse");
      void countEl.offsetWidth;
      countEl.classList.add("brc-pulse");
      applyEffects(count);
    });
  }

  function refreshAuth() {
    chrome.runtime.sendMessage({ type: "GET_AUTH" }, (response) => {
      loggedIn = Boolean(response?.auth);
      renderAuthState();
      applyEffects(lastCount);
    });
  }

  function loadSettings() {
    chrome.storage.local.get({ settings: null }, (stored) => {
      settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      applyEffects(lastCount);
    });
  }

  function makeDraggable(el) {
    let startX, startY, origX, origY, dragging = false;

    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".brc-login")) return; // don't drag from the button
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      el.style.left = origX + (e.clientX - startX) + "px";
      el.style.top = origY + (e.clientY - startY) + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });

    el.addEventListener("pointerup", (e) => {
      dragging = false;
      el.releasePointerCapture(e.pointerId);
    });
  }

  // ---------- main loop ----------

  function tick() {
    const video = currentVideo();

    const wasOnVideoPage = onVideoPage;
    onVideoPage = video !== null;
    setBubbleVisible(onVideoPage);
    if (wasOnVideoPage !== onVideoPage) {
      renderFade(lastCount);
      renderBlocker(lastCount);
    }

    // The SPA keeps swapping <video> elements — re-silence while blocked.
    if (blockerActive) silenceVideos();

    if (!video) {
      lastVideoKey = null;
      return;
    }

    const key = `${video.platform}:${video.videoId}`;
    if (key === lastVideoKey) return;
    lastVideoKey = key;

    // Swiping back to the previous reel isn't a new watch — don't count it.
    if (keyStack.length >= 2 && keyStack[keyStack.length - 2] === key) {
      keyStack.pop();
      return;
    }
    keyStack.push(key);
    if (keyStack.length > 50) keyStack.shift();

    // Only count while logged in — that's the whole game.
    if (loggedIn) {
      chrome.runtime.sendMessage({
        type: "WATCH_EVENT",
        platform: video.platform,
      });
    }
  }

  // Live updates in every tab: background writes storage, all tabs re-render.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.watchedShortform) updateCount();
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      renderedStage = -1; // force icon re-render with the new toggles
      applyEffects(lastCount);
    }
    if (changes.auth) {
      loggedIn = Boolean(changes.auth.newValue);
      renderAuthState();
      renderedStage = -1;
      applyEffects(lastCount);
    }
  });

  ensureBubble();
  renderAuthState();
  refreshAuth();
  loadSettings();
  updateCount();
  setBubbleVisible(currentVideo() !== null);

  // Both sites are SPAs — poll the URL for navigation.
  setInterval(tick, POLL_MS);

  // Keep the 24h rolling window fresh even if the tab just sits open.
  setInterval(updateCount, 60 * 1000);
})();
