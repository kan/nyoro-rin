/**
 * Feedback from players (DESIGN.md 20.2, DATA_CONTRACT.md 「感想」), as in
 * pujan: free text, sent with what the game was showing, and read only by
 * the developer. Nothing of it is ever shown to other players.
 */
import { isCount, isPlayId } from "./attempt";
import { type Difficulty, isDifficulty } from "./model";
import { MAX_APP_VERSION_LENGTH } from "./play-log";
import { isSeedCodeOf, parseSeedCode } from "./seed-code";
import { type AssistLevel, isAssistLevel } from "./settings";
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const FEEDBACK_MAX_LENGTH = 1000;

/** Where the feedback screen was opened from. */
export type FeedbackSource = "menu" | "clear";

/** What the game was showing when the feedback screen opened. */
export interface FeedbackContext {
  readonly from: FeedbackSource;
  /** The board on screen, if any. */
  readonly playId: string | null;
  readonly seedCode: string | null;
  readonly difficulty: Difficulty | null;
  readonly cleared: boolean;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly maxAssist: AssistLevel | null;
  /** The build (vite.config.ts `__APP_VERSION__`). */
  readonly appVersion: string;
}

export interface FeedbackUpload {
  readonly body: string;
  readonly context: FeedbackContext;
}

/** The text as it is sent: trimmed; undefined when empty or too long. */
export function feedbackBody(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const body = value.trim();
  return body.length > 0 && [...body].length <= FEEDBACK_MAX_LENGTH
    ? body
    : undefined;
}

export function parseFeedbackContext(
  value: unknown,
): FeedbackContext | undefined {
  if (!isRecord(value)) return undefined;
  const {
    from,
    playId,
    seedCode,
    difficulty,
    cleared,
    elapsedSeconds,
    hintsUsed,
    maxAssist,
    appVersion,
  } = value;
  if (
    (from !== "menu" && from !== "clear") ||
    (playId !== null && !isPlayId(playId)) ||
    // A board on screen has both, as exactly as the other records write them.
    (seedCode === null) !== (difficulty === null) ||
    (seedCode !== null &&
      (typeof seedCode !== "string" ||
        !isSeedCodeOf(
          seedCode,
          parseSeedCode(seedCode)?.version,
          difficulty,
        ))) ||
    (difficulty !== null && !isDifficulty(difficulty)) ||
    typeof cleared !== "boolean" ||
    !isCount(elapsedSeconds) ||
    !isCount(hintsUsed) ||
    (maxAssist !== null && !isAssistLevel(maxAssist)) ||
    typeof appVersion !== "string" ||
    appVersion.length > MAX_APP_VERSION_LENGTH
  ) {
    return undefined;
  }
  return {
    from,
    playId,
    seedCode,
    difficulty,
    cleared,
    elapsedSeconds,
    hintsUsed,
    maxAssist,
    appVersion,
  };
}

export function parseFeedbackUpload(
  value: unknown,
): FeedbackUpload | undefined {
  if (!isRecord(value)) return undefined;
  const body = feedbackBody(value.body);
  const context = parseFeedbackContext(value.context);
  return body !== undefined && context ? { body, context } : undefined;
}

/** What the screen says it sends with the text, before it is sent. */
export function contextText(context: FeedbackContext): string {
  const parts = [`版 ${context.appVersion || "不明"}`];
  if (context.seedCode) {
    const state = context.cleared ? "クリア済み" : "プレイ中";
    parts.unshift(
      `この問題のシード（${context.seedCode}）`,
      `${state}（${context.elapsedSeconds} 秒、ヒント ${context.hintsUsed} 回）`,
    );
  }
  return parts.join("、");
}

// --- the feedback sent from this device --------------------------------------

export const SENT_FEEDBACK_KEY = "nyoro-rin.sent-feedback.v1";
/** The newest ones kept; the screen lists them under the form. */
export const SENT_FEEDBACK_LIMIT = 20;

export interface SentFeedback {
  readonly sentAt: number;
  readonly body: string;
}

export function loadSentFeedback(
  storage: KeyValueStorage,
): readonly SentFeedback[] {
  return readJson(storage, SENT_FEEDBACK_KEY, parseSentFeedback) ?? [];
}

/** Adds one, newest first, keeping SENT_FEEDBACK_LIMIT. */
export function addSentFeedback(
  storage: KeyValueStorage,
  sent: SentFeedback,
): readonly SentFeedback[] {
  const next = [sent, ...loadSentFeedback(storage)].slice(
    0,
    SENT_FEEDBACK_LIMIT,
  );
  writeJson(storage, SENT_FEEDBACK_KEY, { version: 1, sent: next });
  return next;
}

function parseSentFeedback(value: unknown): SentFeedback[] | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sent)) {
    return undefined;
  }
  const sent: SentFeedback[] = [];
  for (const item of value.sent) {
    if (!isRecord(item) || !isCount(item.sentAt)) return undefined;
    const body = feedbackBody(item.body);
    if (body === undefined) return undefined;
    sent.push({ sentAt: item.sentAt, body });
  }
  return sent;
}
