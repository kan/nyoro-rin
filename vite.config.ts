import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

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
  plugins: [vue()],
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
