import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Generator tests build many boards; CI machines are slower than a laptop.
    testTimeout: 30000,
  },
});
