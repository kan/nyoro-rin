import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
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
  },
});
