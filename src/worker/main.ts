/**
 * The Worker's entry (wrangler.jsonc `main`, and tests/wrangler.jsonc for the
 * tests). workerd takes every named export of this module as an entrypoint,
 * so it exports only the entrypoints: the HTTP API (index.ts, which also
 * exports helpers such as SWEEP_CRON) and GameService.
 */
export { default } from "./index";
export { GameService } from "./game-service";
