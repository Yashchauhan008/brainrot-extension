// Brain Rot Counter — runs on the portal origin only.
// Bridges the logged-in portal session to the extension: the portal
// postMessages the JWT, we hand it to the background worker.

(() => {
  if (window.__brainrotConnectLoaded) return;
  window.__brainrotConnectLoaded = true;

  // Let the portal know the extension is installed.
  window.postMessage({ type: "BRAINROT_EXTENSION_READY" }, window.location.origin);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "BRAINROT_CONNECT" && data.token) {
      chrome.runtime.sendMessage(
        {
          type: "SET_TOKEN",
          token: data.token,
          refresh_token: data.refresh_token || null,
          user: data.user || null,
        },
        () => {
          window.postMessage(
            { type: "BRAINROT_CONNECTED", user: data.user || null },
            window.location.origin,
          );
        },
      );
    }

    if (data.type === "BRAINROT_DISCONNECT") {
      chrome.runtime.sendMessage({ type: "CLEAR_TOKEN" });
    }

    // Portal saved (or loaded) effect settings — apply them immediately
    // instead of waiting for the background worker's periodic sync.
    if (data.type === "BRAINROT_SETTINGS" && data.settings) {
      chrome.runtime.sendMessage({ type: "SET_SETTINGS", settings: data.settings });
    }
  });
})();
