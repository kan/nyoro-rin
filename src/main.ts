import { createApp } from "vue";
import { registerSW } from "virtual:pwa-register";
import App from "./App.vue";
import { startId } from "./ui/auth";
import { browserStorage } from "./ui/browser-storage";
import { takeDailyRequestFromUrl } from "./ui/daily-request";
import { startInstallOffer } from "./ui/install";
import { startPushSync } from "./ui/push";
import { shouldReloadForStaleChunk } from "./ui/stale-chunk";
import "./styles.css";

// The kan-game.app ID comes in the background; play never waits for it.
startId();
// The daily notice follows the ID; a tap on it opens the daily
// (DESIGN.md 25.8).
startPushSync();
takeDailyRequestFromUrl();
// Before mounting: the browser's install prompt may come before the screens.
startInstallOffer();
createApp(App).mount("#app");

// The service worker (vite.config.ts): offline starts. Registered once the
// page has loaded, so its download does not compete with the first board. A
// new version takes over by itself and loads the page again.
registerSW();
// A part of the old version that is gone after a deploy (src/ui/stale-chunk.ts).
window.addEventListener("vite:preloadError", (event) => {
  const storage = browserStorage("sessionStorage");
  if (!storage) return;
  if (!shouldReloadForStaleChunk(storage, navigator.onLine, Date.now())) return;
  event.preventDefault();
  window.location.reload();
});
