import { createApp } from "vue";
import { registerSW } from "virtual:pwa-register";
import App from "./App.vue";
import { startId } from "./ui/auth";
import { browserStorage } from "./ui/browser-storage";
import { startInstallOffer } from "./ui/install";
import { shouldReloadForStaleChunk } from "./ui/stale-chunk";
import "./styles.css";

// The kan-game.app ID comes in the background; play never waits for it.
startId();
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
