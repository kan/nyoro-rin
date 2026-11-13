/**
 * The Worker's entry (wrangler.jsonc `main`). The HTTP API lives in index.ts,
 * which the tests import in Node; GameService needs `cloudflare:workers`,
 * which exists only in the Workers runtime, so it joins here (as TAKO-SEN).
 */
export { default } from "./index";
export { GameService } from "./game-service";
