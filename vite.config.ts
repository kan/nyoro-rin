import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import {
  SERVER_PACKAGES,
  SERVICE_WORKER_PACKAGES,
  licensesPlugin,
} from "./scripts/licenses-plugin.ts";

/**
 * The build sent with play logs and feedback: package.json's version and the
 * commit, as pujan does (`0.0.0+a44dd3f`).
 */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    return `${version}+${commit}`;
  } catch {
    return version;
  }
}

export default defineConfig({
  plugins: [
    vue(),
    // licenses.json for the menu's about page (DESIGN.md 21.2).
    licensesPlugin({
      serviceWorker: SERVICE_WORKER_PACKAGES,
      server: SERVER_PACKAGES,
    }),
    // An installable app with a service worker, as TAKO-SEN has (its
    // vite.config.ts): the screens open offline too (DESIGN.md 21.1).
    VitePWA({
      registerType: "autoUpdate",
      // The manifest's icons are left to the globs below.
      includeManifestIcons: false,
      // Registered from src/main.ts, once the page has loaded.
      injectRegister: false,
      manifest: {
        name: "NYORO-RIN",
        short_name: "NYORO-RIN",
        description: "にょろにょろの輪を描くロジックパズル",
        lang: "ja",
        // The page colour (src/styles.css --color-page).
        theme_color: "#e9efe8",
        background_color: "#e9efe8",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // licenses.json, so the about page lists them offline too. Named
        // alone, so no other JSON joins the precache by accident.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "licenses.json"],
        // Not needed offline: the system fetches the manifest's icons when
        // the app is added.
        globIgnores: [
          "pwa-192.png",
          "pwa-512.png",
          "pwa-maskable-512.png",
          "apple-touch-icon.png",
        ],
        // Every page is the app; the API is never answered from the cache.
        // Its answers depend on the device's ID cookie, which a cache key
        // does not see.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // A new version takes over at once (registerType "autoUpdate" then
        // reloads the page); the old version's files go by the plugin's
        // default. Without these the new worker waits until every tab of the
        // game is closed.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    // The same browsers as TAKO-SEN: iOS Safari before 16.4 is still common.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
  },
  worker: {
    // The puzzle generator runs in a module worker (src/ui/puzzle-worker.ts).
    format: "es",
  },
  server: {
    // Vite admits *.localhost by itself; roji's domain can be another one.
    allowedHosts: process.env.ROJI_HOST ? [process.env.ROJI_HOST] : undefined,
    proxy: {
      // scripts/dev.mjs starts the API on a free port and names it here.
      "/api": `http://127.0.0.1:${process.env.NYORO_API_PORT || 8787}`,
    },
  },
});
