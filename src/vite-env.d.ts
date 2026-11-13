/// <reference types="vite/client" />

/** The build: package.json's version and the commit (vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** The local kan-game.app portal, set by scripts/dev.mjs. */
  readonly VITE_KAN_GAME_PORTAL?: string;
}
