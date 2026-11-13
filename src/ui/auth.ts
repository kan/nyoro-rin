import { readonly, ref, type Ref } from "vue";

/**
 * The kan-game.app ID of this device: the one place the screens get it from
 * (kan/game docs/ID_DESIGN.md), as in TAKO-SEN's src/ui/auth.ts. Every
 * visitor gets an ID automatically from POST /api/id/session, which this
 * origin passes on to the ID platform. The ID itself lives in an HttpOnly
 * cookie that goes with every /api request, so the screens never send a
 * token; they only need to know which ID it is.
 */

export type IdStatus =
  /** Asking the ID platform; the last known ID, if any, is already set. */
  | "loading"
  /** The ID platform confirmed `id`. */
  | "ready"
  /** No connection. `id` is the last one this device knew, if any. */
  | "offline"
  /** The platform refused (rate limit, outage). It is asked again later. */
  | "unavailable";

export interface KanGameId {
  /** The ID, or null before this device ever got one. */
  readonly id: Readonly<Ref<string | null>>;
  /** The kan-game.app name, possibly chosen in another game. */
  readonly name: Readonly<Ref<string | null>>;
  readonly status: Readonly<Ref<IdStatus>>;
}

/**
 * The last ID the platform confirmed. Not a credential (the cookie is), but
 * it lets a device that already has an ID keep its offline clears for it.
 */
const ID_KEY = "nyoro-rin.kan-game-id.v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function storedId(): string | null {
  try {
    const value = localStorage.getItem(ID_KEY);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storeId(value: string | null): void {
  try {
    if (value) localStorage.setItem(ID_KEY, value);
    else localStorage.removeItem(ID_KEY);
  } catch {
    // Without storage the ID is known again once the platform answers.
  }
}

const id = ref<string | null>(null);
const name = ref<string | null>(null);
const status = ref<IdStatus>("loading");
let started = false;
let pending: Promise<void> | undefined;

function accept(body: unknown): boolean {
  const value = body as { id?: unknown; name?: unknown } | null;
  if (typeof value?.id !== "string" || !UUID.test(value.id)) return false;
  id.value = value.id;
  name.value = typeof value.name === "string" ? value.name : null;
  status.value = "ready";
  storeId(value.id);
  return true;
}

function postSession(): Promise<Response> {
  return fetch("/api/id/session", { method: "POST" });
}

async function askSession(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    status.value = "offline";
    return;
  }
  status.value = "loading";
  try {
    let response = await postSession();
    // A withdrawn ID: that answer cleared its cookie, and asking again issues
    // a new ID (kan/game src/session.ts).
    if (response.status === 410) {
      forgetId();
      response = await postSession();
    }
    if (response.ok && accept(await response.json())) return;
    status.value = "unavailable";
  } catch {
    status.value = "offline";
  }
}

let lastAsked = -Infinity;

/** Asks the ID platform for this device's ID, once at a time. */
export function refreshId(): Promise<void> {
  pending ??= askSession().finally(() => {
    pending = undefined;
  });
  lastAsked = Date.now();
  return pending;
}

/**
 * A 401 asks again at most this often: a device whose cookie is not kept
 * would otherwise ask after every request its retry timers make.
 */
const UNAUTHORIZED_RETRY_MS = 60_000;

function forgetId(): void {
  id.value = null;
  name.value = null;
  storeId(null);
}

/** How often a device asks again while its ID is not confirmed. */
const UNCONFIRMED_RETRY_MS = 30_000;

/**
 * Starts the ID once per page: the last known ID at once, then the platform's
 * answer, again whenever the connection comes back, and every half minute for
 * as long as the platform has not confirmed an ID. A device that knows its
 * ID from before still waits for that: nothing is sent until then.
 */
export function startId(): void {
  if (started) return;
  started = true;
  id.value = storedId();
  window.addEventListener("online", () => void refreshId());
  window.setInterval(() => {
    if (status.value !== "ready" && status.value !== "loading") {
      void refreshId();
    }
  }, UNCONFIRMED_RETRY_MS);
  void refreshId();
}

export function useId(): KanGameId {
  return { id: readonly(id), name: readonly(name), status: readonly(status) };
}

/** A name registered here becomes the ID's kan-game.app name. */
export function setIdName(value: string): void {
  name.value = value;
}

/**
 * fetch for NYORO-RIN's own API, which reads the ID from the cookie. After a
 * 410 the withdrawn ID is dropped and a new one fetched; after a 401 (the
 * cookie was cleared, or never set while offline) the ID is asked for again.
 * Screens keyed by `id` follow. The response is returned as it is.
 */
export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 410) {
    forgetId();
    void refreshId();
  } else if (
    response.status === 401 &&
    Date.now() - lastAsked >= UNAUTHORIZED_RETRY_MS
  ) {
    void refreshId();
  }
  return response;
}

/** A POST of JSON to NYORO-RIN's API. */
export function apiPost(path: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A page of the kan-game.app portal: the account screen (recovery codes,
 * withdrawal), the terms and the privacy policy live there, not in each game.
 * The portal follows this page's host (nyoro-dev.kan-game.app →
 * dev.kan-game.app), so a build cannot point at another environment's
 * portal. Any other public host gets the production portal; only local
 * hosts get the local one.
 */
export function portalUrl(
  path: "/" | "/account" | "/privacy" | "/terms",
  host = new URL(window.location.href).hostname,
): string {
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    // A phone reaching the dev machine by its LAN address.
    /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const portal = host.endsWith(".kan-game.app")
    ? host.split(".")[0].endsWith("-dev")
      ? "https://dev.kan-game.app"
      : "https://kan-game.app"
    : local
      ? // kan/game's portal runs beside the game (scripts/dev.mjs).
        import.meta.env.VITE_KAN_GAME_PORTAL || "http://localhost:8787"
      : "https://kan-game.app";
  return new URL(path, portal).href;
}
