/**
 * The HTTP API (DATA_CONTRACT.md 「API」) and the static screen. Routes are
 * matched by hand, as in TAKO-SEN; anything outside /api/ is the screen.
 */
import { isClientUnlockable } from "../core/achievements";
import {
  RANKING_CONSENT_VERSION,
  validateGameName,
} from "../core/account-profile";
import { isPlayId } from "../core/attempt";
import {
  dailyDate,
  isDailyDate,
  parseDailyCompletionUpload,
} from "../core/daily";
import { parseFeedbackUpload } from "../core/feedback";
import {
  parseCompletedPlayUpload,
  verifyCompletedPlayUpload,
} from "../core/online-play";
import { isDifficulty } from "../core/model";
import { parsePlayLogUpload } from "../core/play-log";
import { isPuzzleId } from "../core/puzzle-identity";
import { isWeeklyMetric } from "../core/weekly-ranking";
import { sweepDeletedAccounts } from "./accounts";
import {
  judgeAfterClear,
  listAchievements,
  unlockClientAchievement,
} from "./achievements";
import { authenticateAccount } from "./auth";
import {
  completeDailyAttempt,
  getDailyStatus,
  listDailyHistory,
  listDailyRanking,
  prepareNextDailyBoard,
  startDailyAttempt,
} from "./daily";
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
import {
  deleteSubscription,
  parseSubscription,
  saveSubscription,
  sendDailyNotifications,
  vapidKeys,
} from "./push";
import { listLeaderboard } from "./leaderboard";
import { listNextPuzzleCandidates } from "./next-puzzle";
import { listWeeklyRanking } from "./weekly-ranking";
import { getAccountProfile, registerAccountProfile } from "./profile";

const MAX_BODY_BYTES = 4096;
/**
 * A play log of MAX_LOG_EVENTS events, resets included (each lists every
 * edge it cleared), fits with room to spare.
 */
const MAX_PLAY_LOG_BYTES = 1024 * 1024;
/** 1,000 characters of up to 4 bytes, and the context. */
const MAX_FEEDBACK_BYTES = 8192;

/** The daily runs, which must match wrangler.jsonc's triggers. */
export const SWEEP_CRON = "0 18 * * *";
/** 23:00 in Japan: tomorrow's daily board (DESIGN.md 25.3). */
export const DAILY_CRON = "0 14 * * *";
/**
 * 23:30 in Japan: the same again, for a 23:00 run that failed. It does
 * nothing when the board is there. A board neither run made is made by the
 * day's first request, which costs that request seconds of CPU.
 */
export const DAILY_RETRY_CRON = "30 14 * * *";
/** 0:05 in Japan: tells subscribed devices the day's daily has opened (25.8). */
export const NOTICE_CRON = "5 15 * * *";

type Handler = (
  env: Env,
  accountId: string,
  body: unknown,
) => Promise<Response>;

/** A route that needs the ID cookie: its GET, its POST, its DELETE. */
interface AccountRoute {
  readonly get?: (env: Env, accountId: string, url: URL) => Promise<Response>;
  readonly post?: Handler;
  /** Takes a JSON body, as a POST does. */
  readonly delete?: Handler;
  /** The largest body the POST or DELETE takes, in bytes. */
  readonly limit?: number;
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
  "/api/next-puzzle": { get: getNextPuzzle },
  // Achievements need an ID only, like the history: no name or consent.
  "/api/achievements": {
    get: async (env, accountId) =>
      json({
        achievements: await listAchievements(env.DB, accountId, Date.now()),
      }),
  },
  "/api/achievements/unlock": {
    post: postAchievementUnlock,
    limit: MAX_BODY_BYTES,
  },
  // The daily challenge (DESIGN.md chapter 25). The board and the records
  // need an ID; starting needs a name and consent too.
  "/api/daily": { get: getDaily },
  "/api/daily/start": { post: postDailyStart, limit: MAX_BODY_BYTES },
  "/api/daily/complete": { post: postDailyComplete, limit: MAX_BODY_BYTES },
  "/api/daily/ranking": { get: getDailyRanking },
  "/api/daily/history": {
    get: async (env, accountId) =>
      json({ plays: await listDailyHistory(env.DB, accountId) }),
  },
  "/api/play-logs": { post: postPlayLog, limit: MAX_PLAY_LOG_BYTES },
  "/api/feedback": { post: postFeedback, limit: MAX_FEEDBACK_BYTES },
  // The daily notice (DESIGN.md 25.8): an ID only, no name or consent.
  "/api/push/subscription": {
    post: postPushSubscription,
    delete: deletePushSubscription,
    limit: MAX_BODY_BYTES,
  },
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
    if (pathname === "/api/weekly-ranking") {
      return weeklyRanking(request, env);
    }
    if (pathname === "/api/push/key") {
      if (request.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      }
      // Empty where push is not set up, so the screen disables the setting.
      return json({ publicKey: vapidKeys(env)?.publicKey ?? "" });
    }
    const route = ACCOUNT_ROUTES[pathname];
    if (!route) {
      if (pathname.startsWith("/api/"))
        return json({ error: "not_found" }, 404);
      return env.ASSETS.fetch(request);
    }
    const methods = [
      ...(route.get ? ["GET"] : []),
      ...(route.post ? ["POST"] : []),
      ...(route.delete ? ["DELETE"] : []),
    ];
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

      if (request.method === "GET") {
        return await route.get!(env, accountId, new URL(request.url));
      }
      const handler = request.method === "DELETE" ? route.delete : route.post;
      const body = await readJsonBody(request, route.limit ?? MAX_BODY_BYTES);
      return body.error ?? (await handler!(env, accountId, body.value));
    } catch (error) {
      logError("api_failure", error);
      return json({ error: "service_unavailable" }, 503);
    }
  },

  async scheduled(controller, env): Promise<void> {
    if (controller.cron === SWEEP_CRON) {
      await sweepDeletedAccounts(env.DB);
      return;
    }
    if (
      controller.cron === DAILY_CRON ||
      controller.cron === DAILY_RETRY_CRON
    ) {
      // A failure here is retried at 23:30, then by the day's first request.
      if (!env.DAILY_SEED_SECRET) {
        logError("daily_prepare_failure", "DAILY_SEED_SECRET is not set");
        return;
      }
      await prepareNextDailyBoard(
        env.DB,
        env.DAILY_SEED_SECRET,
        controller.scheduledTime,
      );
      return;
    }
    if (controller.cron === NOTICE_CRON) {
      // A board the 23:00 and 23:30 runs missed is made by the first player
      // who opens the daily, so the notice goes out either way.
      try {
        const counts = await sendDailyNotifications(env);
        console.log(JSON.stringify({ event: "daily_push", ...counts }));
      } catch (error) {
        logError("daily_push_run_failure", error);
        throw error;
      }
      return;
    }
    console.error(
      JSON.stringify({ event: "unknown_cron", cron: controller.cron }),
    );
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
 * GET /api/weekly-ranking?difficulty=easy|normal|hard&metric=clears|score:
 * this week's players, readable without an ID. A cookie only marks the
 * viewer's own row.
 */
async function weeklyRanking(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  const params = new URL(request.url).searchParams;
  const difficulty = params.get("difficulty");
  const metric = params.get("metric");
  if (!isDifficulty(difficulty) || !isWeeklyMetric(metric)) {
    return json({ error: "invalid_query" }, 400);
  }
  try {
    const auth = request.headers.has("Cookie")
      ? await authenticateAccount(request, env)
      : undefined;
    const viewer = auth?.status === "ok" ? auth.accountId : undefined;
    return json(await listWeeklyRanking(env.DB, difficulty, metric, viewer));
  } catch (error) {
    logError("weekly_ranking_read_failure", error);
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

/**
 * GET /api/next-puzzle?difficulty=...: ranked boards the account has not
 * completed, for its next puzzle (DESIGN.md 13.8).
 */
async function getNextPuzzle(
  env: Env,
  accountId: string,
  url: URL,
): Promise<Response> {
  const difficulty = url.searchParams.get("difficulty");
  if (!isDifficulty(difficulty)) {
    return json({ error: "invalid_difficulty" }, 400);
  }
  return json({
    candidates: await listNextPuzzleCandidates(env.DB, accountId, difficulty),
  });
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
  // Judged only for a new record: a resend announces nothing again.
  const newAchievements =
    outcome === "created"
      ? await judgeAfterClear(env.DB, accountId, claimed.playId, Date.now())
      : [];
  // The screen shows this board's ranking right after a clear; returning it
  // here saves a second request. The record is stored either way.
  const entries = await listLeaderboard(
    env.DB,
    claimed.puzzleId,
    accountId,
  ).catch(() => undefined);
  return json(
    { status: outcome, entries, newAchievements },
    outcome === "created" ? 201 : 200,
  );
}

/** A daily request without the seed key set: nothing to make boards with. */
function dailyUnavailable(env: Env): Response | undefined {
  if (env.DAILY_SEED_SECRET) return undefined;
  logError("daily_unavailable", "DAILY_SEED_SECRET is not set");
  return json({ error: "daily_unavailable" }, 503);
}

/**
 * GET /api/daily: today's board without its solution, and whether the ID
 * has started or completed it. Makes the board if the scheduled run missed.
 */
async function getDaily(env: Env, accountId: string): Promise<Response> {
  return (
    dailyUnavailable(env) ??
    json(
      await getDailyStatus(
        env.DB,
        env.DAILY_SEED_SECRET,
        accountId,
        Date.now(),
      ),
    )
  );
}

/**
 * POST /api/daily/start, at READY's OK: takes the ID's one challenge of the
 * day. Only a named player who consented to the ranking may take it.
 */
async function postDailyStart(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const unavailable = dailyUnavailable(env);
  if (unavailable) return unavailable;
  const { date, playId } = (body ?? {}) as { date?: unknown; playId?: unknown };
  if (!isDailyDate(date) || !isPlayId(playId)) {
    return json({ error: "invalid_daily_start" }, 400);
  }
  if (!(await getAccountProfile(env.DB, accountId))) {
    return json({ error: "profile_required" }, 403);
  }
  const outcome = await startDailyAttempt(
    env.DB,
    env.DAILY_SEED_SECRET,
    accountId,
    date,
    playId,
    Date.now(),
  );
  if (outcome === "started") return json({ status: outcome }, 201);
  if (outcome === "duplicate") return json({ status: outcome });
  return json({ error: "daily_unavailable_to_start", status: outcome }, 409);
}

/**
 * POST /api/daily/complete: the loop is checked against the stored
 * solution; answered with the day's ranking, as a clear is.
 */
async function postDailyComplete(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const upload = parseDailyCompletionUpload(body);
  if (!upload) return json({ error: "invalid_daily_completion" }, 400);
  const outcome = await completeDailyAttempt(
    env.DB,
    accountId,
    upload,
    Date.now(),
  );
  if (outcome === "invalid_solution" || outcome === "invalid_time") {
    return json({ error: outcome }, 400);
  }
  if (outcome === "not_started" || outcome === "expired") {
    return json({ error: "daily_not_started", status: outcome }, 409);
  }
  // Judged only for a new completion, as for a clear (DATA_CONTRACT.md 「実績」).
  const newAchievements =
    outcome === "completed"
      ? await judgeAfterClear(env.DB, accountId, upload.playId, Date.now())
      : [];
  const entries = await listDailyRanking(env.DB, upload.date, accountId).catch(
    () => undefined,
  );
  return json(
    { status: outcome, entries, newAchievements },
    outcome === "completed" ? 201 : 200,
  );
}

/** GET /api/daily/ranking?date=YYYY-MM-DD: a day up to today. */
async function getDailyRanking(
  env: Env,
  accountId: string,
  url: URL,
): Promise<Response> {
  const date = url.searchParams.get("date");
  if (!isDailyDate(date) || date > dailyDate(Date.now())) {
    return json({ error: "invalid_date" }, 400);
  }
  return json({
    date,
    entries: await listDailyRanking(env.DB, date, accountId),
  });
}

/**
 * POST /api/achievements/unlock: one the screen reports (the tutorial's
 * end). Any other id is refused: the rest are judged from the records.
 */
async function postAchievementUnlock(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const id = (body as { id?: unknown } | null)?.id;
  if (!isClientUnlockable(id)) {
    return json({ error: "invalid_achievement" }, 400);
  }
  const created = await unlockClientAchievement(
    env.DB,
    accountId,
    id as string,
    Date.now(),
  );
  return json({ newAchievements: created ? [id] : [] });
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

/**
 * POST /api/push/subscription: the device's subscription, kept under its
 * ID (DESIGN.md 25.8). A device sent again under another ID moves to it.
 */
async function postPushSubscription(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const subscription = parseSubscription(body);
  if (!subscription) return json({ error: "invalid_subscription" }, 400);
  if (!(await saveSubscription(env.DB, accountId, subscription, Date.now()))) {
    return json({ error: "too_many_devices" }, 409);
  }
  return json({ ok: true });
}

/** DELETE /api/push/subscription: `{ endpoint }`, the ID's own only. */
async function deletePushSubscription(
  env: Env,
  accountId: string,
  body: unknown,
): Promise<Response> {
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== "string") {
    return json({ error: "invalid_subscription" }, 400);
  }
  await deleteSubscription(env.DB, accountId, endpoint);
  return json({ ok: true });
}

/** A JSON body of a POST or DELETE, or the response that refuses it. */
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
