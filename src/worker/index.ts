/**
 * The HTTP API (DATA_CONTRACT.md 「API」) and the static screen. Routes are
 * matched by hand, as in TAKO-SEN; anything outside /api/ is the screen.
 */
import {
  RANKING_CONSENT_VERSION,
  validateGameName,
} from "../core/account-profile";
import { parseFeedbackUpload } from "../core/feedback";
import {
  parseCompletedPlayUpload,
  verifyCompletedPlayUpload,
} from "../core/online-play";
import { parsePlayLogUpload } from "../core/play-log";
import { isPuzzleId } from "../core/puzzle-identity";
import { sweepDeletedAccounts } from "./accounts";
import { authenticateAccount } from "./auth";
import { saveFeedback } from "./feedback";
import {
  type SaveOutcome,
  compareStoredPlay,
  listCompletedPlays,
  saveCompletedPlay,
  takeUploadSlot,
} from "./history";
import { savePlayLog } from "./play-logs";
import { idPlatform } from "./id-platform";
import { listLeaderboard } from "./leaderboard";
import { getAccountProfile, registerAccountProfile } from "./profile";

const MAX_BODY_BYTES = 4096;
/**
 * A play log of MAX_LOG_EVENTS events, resets included (each lists every
 * edge it cleared), fits with room to spare.
 */
const MAX_PLAY_LOG_BYTES = 1024 * 1024;
/** 1,000 characters of up to 4 bytes, and the context. */
const MAX_FEEDBACK_BYTES = 8192;

/** The daily run, which must match wrangler.jsonc's triggers. */
export const SWEEP_CRON = "0 18 * * *";

type Handler = (
  env: Env,
  accountId: string,
  body: unknown,
) => Promise<Response>;

/** A route that needs the ID cookie: its GET, if any, and its POST. */
interface AccountRoute {
  readonly get?: (env: Env, accountId: string) => Promise<Response>;
  readonly post: Handler;
  /** The largest body the POST takes, in bytes. */
  readonly limit: number;
}

const ACCOUNT_ROUTES: Readonly<Record<string, AccountRoute>> = {
  "/api/profile": {
    get: async (env, accountId) =>
      json({ profile: await getAccountProfile(env.DB, accountId) }),
    post: postProfile,
    limit: MAX_BODY_BYTES,
  },
  "/api/plays": {
    get: async (env, accountId) =>
      json({ plays: await listCompletedPlays(env.DB, accountId) }),
    post: postPlay,
    limit: MAX_BODY_BYTES,
  },
  "/api/play-logs": { post: postPlayLog, limit: MAX_PLAY_LOG_BYTES },
  "/api/feedback": { post: postFeedback, limit: MAX_FEEDBACK_BYTES },
};

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    // The ID API, served as if from this origin (kan/game docs/ID_DESIGN.md
    // 「HTTP の API」). The request goes on unchanged: the platform limits
    // requests by CF-Connecting-IP and checks Origin itself.
    if (pathname.startsWith("/api/id/")) {
      try {
        return await env.ID.fetch(request);
      } catch (error) {
        logError("id_proxy_failure", error);
        return json({ error: "service_unavailable" }, 503);
      }
    }
    if (pathname.startsWith("/api/leaderboards/")) {
      return leaderboard(request, env, pathname);
    }
    const route = ACCOUNT_ROUTES[pathname];
    if (!route) {
      if (pathname.startsWith("/api/"))
        return json({ error: "not_found" }, 404);
      return env.ASSETS.fetch(request);
    }
    const methods = route.get ? ["GET", "POST"] : ["POST"];
    if (!methods.includes(request.method)) {
      return json({ error: "method_not_allowed" }, 405, {
        Allow: methods.join(", "),
      });
    }
    const allowedOrigins = env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (allowedOrigins.length === 0) {
      return json({ error: "service_unavailable" }, 503);
    }
    // The ID cookie goes with any request to kan-game.app, so a POST must name
    // an allowed origin; browsers always send Origin with those. A same-origin
    // GET may omit it, so GETs cannot require it.
    const origin = request.headers.get("Origin");
    if (origin ? !allowedOrigins.includes(origin) : request.method !== "GET") {
      return json({ error: "forbidden_origin" }, 403);
    }

    try {
      const auth = await authenticateAccount(request, env);
      if (auth.status === "unauthorized") {
        return json({ error: "unauthorized" }, 401);
      }
      // The screen asks the ID platform for a new ID after this.
      if (auth.status === "deleted") return json({ error: "id_deleted" }, 410);
      const { accountId } = auth;

      if (request.method === "GET") return await route.get!(env, accountId);
      const body = await readJsonBody(request, route.limit);
      return body.error ?? (await route.post(env, accountId, body.value));
    } catch (error) {
      logError("api_failure", error);
      return json({ error: "service_unavailable" }, 503);
    }
  },

  async scheduled(controller, env): Promise<void> {
    if (controller.cron !== SWEEP_CRON) {
      console.error(
        JSON.stringify({ event: "unknown_cron", cron: controller.cron }),
      );
      return;
    }
    await sweepDeletedAccounts(env.DB);
  },
} satisfies ExportedHandler<Env>;

/**
 * GET /api/leaderboards/:puzzleId, open to anyone. A valid ID cookie only
 * marks the requester's own row; a missing or bad one is not an error.
 */
async function leaderboard(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  let id: string;
  try {
    id = decodeURIComponent(pathname.slice("/api/leaderboards/".length));
  } catch {
    return json({ error: "invalid_puzzle_id" }, 400);
  }
  if (!isPuzzleId(id)) {
    return json({ error: "invalid_puzzle_id" }, 400);
  }
  try {
    const auth = request.headers.has("Cookie")
      ? await authenticateAccount(request, env)
      : undefined;
    const viewer = auth?.status === "ok" ? auth.accountId : undefined;
    return json({ entries: await listLeaderboard(env.DB, id, viewer) });
  } catch (error) {
    logError("leaderboard_read_failure", error);
    return json({ error: "service_unavailable" }, 503);
  }
}

/**
 * POST /api/profile. Names are kan-game.app-wide: the ID platform registers
 * the name and judges duplicates, and NYORO-RIN keeps a copy with its own
 * consent. An ID named in another game keeps that name.
 */
async function postProfile(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const fields = body as { displayName?: unknown; consentVersion?: unknown };
  const requested = validateGameName(fields?.displayName);
  if (!requested || fields?.consentVersion !== RANKING_CONSENT_VERSION) {
    return json({ error: "invalid_profile" }, 400);
  }
  const registered = await idPlatform(env).registerName(accountId, requested);
  if (registered.result === "name_taken") {
    return json({ error: "name_taken" }, 409);
  }
  if (registered.result === "invalid") {
    return json({ error: "invalid_profile" }, 400);
  }
  if (registered.result === "no_id") return json({ error: "id_deleted" }, 410);
  if (registered.result !== "ok" && registered.result !== "already_named") {
    // A result added to kan/game's src/rpc.ts fails to compile here.
    const unexpected: never = registered;
    throw new Error(
      `Unexpected registerName result: ${JSON.stringify(unexpected)}`,
    );
  }
  try {
    return json({
      profile: await registerAccountProfile(env.DB, accountId, registered.name),
    });
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint failed")) throw error;
    // The platform gave the ID this name, yet another account here holds it:
    // NYORO-RIN's copy of the names has drifted from the platform's.
    console.error(
      JSON.stringify({ event: "profile_name_out_of_sync", accountId }),
    );
    return json({ error: "name_taken" }, 409);
  }
}

/** POST /api/plays: one verified clear, answered with the puzzle's ranking. */
async function postPlay(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const claimed = parseCompletedPlayUpload(body);
  if (!claimed) return json({ error: "invalid_play" }, 400);
  // A resend is answered from what is stored: regenerating a hard board
  // takes far more CPU than the lookup.
  let outcome: SaveOutcome | undefined = await compareStoredPlay(
    env.DB,
    accountId,
    claimed,
  );
  if (!outcome) {
    if (!(await takeUploadSlot(env.DB, accountId, Date.now()))) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }
    try {
      await verifyCompletedPlayUpload(claimed);
    } catch {
      return json({ error: "invalid_play" }, 400);
    }
    outcome = await saveCompletedPlay(env.DB, accountId, claimed);
  }
  if (outcome === "conflict") return json({ error: "play_id_conflict" }, 409);
  // The screen shows this board's ranking right after a clear; returning it
  // here saves a second request. The record is stored either way.
  const entries = await listLeaderboard(
    env.DB,
    claimed.puzzleId,
    accountId,
  ).catch(() => undefined);
  return json({ status: outcome, entries }, outcome === "created" ? 201 : 200);
}

/**
 * POST /api/play-logs: one attempt's log (DATA_CONTRACT.md 「プレイログ」).
 * A resend of a stored log is a success, so the screen's queue can retry.
 */
async function postPlayLog(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const log = parsePlayLogUpload(body);
  if (!log) return json({ error: "invalid_play_log" }, 400);
  const outcome = await savePlayLog(env.DB, accountId, log, Date.now());
  if (outcome === "rate_limited") {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "3600" });
  }
  return json({ status: outcome }, outcome === "created" ? 201 : 200);
}

/** POST /api/feedback (DATA_CONTRACT.md 「感想」). */
async function postFeedback(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const feedback = parseFeedbackUpload(body);
  if (!feedback) return json({ error: "invalid_feedback" }, 400);
  if (!(await saveFeedback(env.DB, accountId, feedback, Date.now()))) {
    return json({ error: "too_many" }, 429, { "Retry-After": "3600" });
  }
  return json({ status: "created" }, 201);
}

/** A JSON body of a POST, or the response that refuses it. */
async function readJsonBody(
  request: Request,
  limit: number,
): Promise<{ value: unknown; error?: undefined } | { error: Response }> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return { error: json({ error: "unsupported_media_type" }, 415) };
  }
  try {
    return { value: JSON.parse(await readLimitedBody(request, limit)) };
  } catch {
    return { error: json({ error: "invalid_body" }, 400) };
  }
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function logError(event: string, error: unknown): void {
  console.error(JSON.stringify({ event, error: String(error) }));
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Body too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(data);
}
