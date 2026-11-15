import { type KeyValueStorage } from "../core/storage";

const MARK_KEY = "nyoro-rin.stale-chunk-reload";
/** One reload per this long, so a file that never comes cannot loop. */
const RELOAD_GAP_MS = 60_000;

/**
 * After a deploy, the new service worker drops the old files, and a tab still
 * running the old screens then fails to fetch a part it loads later (the
 * tutorial): the server answers the old name with the page itself, and Vite
 * reports it as vite:preloadError (src/main.ts). Loading the page again
 * brings the new screens; the game keeps its board in storage. The same as
 * TAKO-SEN's src/ui/stale-chunk.ts.
 *
 * Returns whether to reload: online only (offline the reload would only lose
 * the screen), and not twice within a minute. `storage` is the tab's own
 * (sessionStorage), so one tab's reload does not hold another back.
 */
export function shouldReloadForStaleChunk(
  storage: KeyValueStorage,
  online: boolean,
  now: number,
): boolean {
  if (!online) return false;
  try {
    const last = Number(storage.getItem(MARK_KEY));
    if (Number.isFinite(last) && now - last < RELOAD_GAP_MS) return false;
    storage.setItem(MARK_KEY, String(now));
    return true;
  } catch {
    // Without storage the gap cannot be kept: do not risk a loop.
    return false;
  }
}
