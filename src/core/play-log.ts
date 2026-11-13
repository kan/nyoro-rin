/**
 * The play log (DESIGN.md 20.1, DATA_CONTRACT.md 「プレイログ」): what the
 * player did during one attempt, in order, for finding where players get
 * stuck. Each event carries `t`, the play clock in milliseconds (paused time
 * does not count), so the gaps between events are thinking time.
 *
 * Every change to the board is a `move` with the edges it changed, undo and
 * reset included, so replaying a log is applying its moves in order.
 *
 * The log is kept on the device beside the board in play, and sent when the
 * attempt ends: cleared, or left unsolved for another board. It is never
 * shown to other players.
 */
import {
  type Attempt,
  type HintStage,
  isCount,
  isHintStage,
  isPlayId,
  parseAttempt,
} from "./attempt";
import {
  CROSS,
  type Difficulty,
  type EdgeState,
  type EdgeStates,
  LINE,
  UNKNOWN,
  isDifficulty,
} from "./model";
import { isSeedCodeOf } from "./seed-code";
import { type AssistLevel, type Tool, isAssistLevel, isTool } from "./settings";
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const PLAY_LOG_KEY = "nyoro-rin.play-log.v1";

/** A log stops growing here (and says so); a real one is far shorter. */
export const MAX_LOG_EVENTS = 3000;

/** The longest build name a record may carry. */
export const MAX_APP_VERSION_LENGTH = 64;

/** One changed edge as `[edge, before, after]`, as the saved board writes it. */
export type LoggedChange = readonly [number, EdgeState, EdgeState];

/** What changed the board. */
export type MoveSource =
  /** A tap on an edge. */
  | "tap"
  /** The first edges of a stroke. */
  | "stroke"
  /** More edges of the stroke just before. */
  | "stroke-more"
  /** A hint's step 3 wrote it. */
  | "hint"
  | "undo"
  | "redo"
  /** Every mark cleared. */
  | "reset";

const MOVE_SOURCES: readonly unknown[] = [
  "tap",
  "stroke",
  "stroke-more",
  "hint",
  "undo",
  "redo",
  "reset",
] satisfies MoveSource[];

/** What a hint step showed: a technique's ID, or MISTAKE or REVEAL. */
export type HintLabel = string;

export type PlayOutcome = "cleared" | "abandoned";

export type PlayLogEvent =
  /** READY's OK: the clock runs. */
  | readonly ["start", number]
  /** Back to READY. */
  | readonly ["pause", number]
  | readonly ["move", number, MoveSource, readonly LoggedChange[]]
  /** A hint step shown: 1 focus, 2 reason, 3 apply. */
  | readonly ["hint", number, Exclude<HintStage, 0>, HintLabel]
  | readonly ["assist", number, AssistLevel]
  | readonly ["tool", number, Tool]
  /** Long press: the magnified view opened. */
  | readonly ["zoom", number]
  | readonly ["end", number, PlayOutcome];

export interface PlayLog {
  readonly playId: string;
  readonly events: readonly PlayLogEvent[];
  /** Whether events were dropped at MAX_LOG_EVENTS. */
  readonly truncated: boolean;
}

export function emptyPlayLog(playId: string): PlayLog {
  return { playId, events: [], truncated: false };
}

/** Adds an event; past the limit only the end is still added. */
export function appendEvent(log: PlayLog, event: PlayLogEvent): PlayLog {
  if (log.events.length >= MAX_LOG_EVENTS && event[0] !== "end") {
    return log.truncated ? log : { ...log, truncated: true };
  }
  return { ...log, events: [...log.events, event] };
}

/** The edges whose state differs, as logged changes, ascending. */
export function changesBetween(
  before: EdgeStates,
  after: EdgeStates,
): LoggedChange[] {
  const changes: LoggedChange[] = [];
  for (let edge = 0; edge < after.length; edge += 1) {
    if (before[edge] !== after[edge]) {
      changes.push([edge, before[edge] as EdgeState, after[edge] as EdgeState]);
    }
  }
  return changes;
}

/** Whether the log already ended. */
export function hasEnded(log: PlayLog): boolean {
  return log.events.at(-1)?.[0] === "end";
}

// --- saving on the device ---------------------------------------------------

export function loadPlayLog(storage: KeyValueStorage, playId: string): PlayLog {
  const saved = readJson(storage, PLAY_LOG_KEY, parsePlayLog);
  return saved?.playId === playId ? saved : emptyPlayLog(playId);
}

export function savePlayLog(storage: KeyValueStorage, log: PlayLog): boolean {
  return writeJson(storage, PLAY_LOG_KEY, { version: 1, ...log });
}

function parsePlayLog(value: unknown): PlayLog | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const { playId, events, truncated } = value;
  if (
    !isPlayId(playId) ||
    typeof truncated !== "boolean" ||
    !isEventList(events)
  ) {
    return undefined;
  }
  return { playId, events, truncated };
}

const EDGE_STATES: readonly unknown[] = [UNKNOWN, LINE, CROSS];
/** A technique ID, MISTAKE or REVEAL: capitals and underscores. */
const HINT_LABEL = /^[A-Z_]{1,32}$/;
/** More edges than any board has; the reader checks the board's own count. */
const MAX_EDGE = 1000;

function isChange(value: unknown): value is LoggedChange {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isCount(value[0]) &&
    value[0] < MAX_EDGE &&
    EDGE_STATES.includes(value[1]) &&
    EDGE_STATES.includes(value[2]) &&
    value[1] !== value[2]
  );
}

function isPlayOutcome(value: unknown): value is PlayOutcome {
  return value === "cleared" || value === "abandoned";
}

export function isPlayLogEvent(value: unknown): value is PlayLogEvent {
  if (!Array.isArray(value) || !isCount(value[1])) return false;
  const [kind, , a, b] = value;
  switch (kind) {
    case "start":
    case "pause":
    case "zoom":
      return value.length === 2;
    case "move":
      return (
        value.length === 4 &&
        MOVE_SOURCES.includes(a) &&
        Array.isArray(b) &&
        b.length > 0 &&
        b.every(isChange)
      );
    case "hint":
      return (
        value.length === 4 &&
        isHintStage(a) &&
        a !== 0 &&
        typeof b === "string" &&
        HINT_LABEL.test(b)
      );
    case "assist":
      return value.length === 3 && isAssistLevel(a);
    case "tool":
      return value.length === 3 && isTool(a);
    case "end":
      return value.length === 3 && isPlayOutcome(a);
    default:
      return false;
  }
}

function isEventList(value: unknown): value is PlayLogEvent[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LOG_EVENTS + 1 &&
    value.every(isPlayLogEvent)
  );
}

// --- sending ----------------------------------------------------------------

/** POST /api/play-logs (DATA_CONTRACT.md 「プレイログ」). */
export interface PlayLogUpload extends Attempt {
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: Difficulty;
  readonly outcome: PlayOutcome;
  readonly endedAt: number;
  /** The play clock when the attempt ended. */
  readonly elapsedMs: number;
  /** The build that recorded it (vite.config.ts `__APP_VERSION__`). */
  readonly appVersion: string;
  readonly truncated: boolean;
  readonly events: readonly PlayLogEvent[];
}

/** Checks an upload's shape and ranges; undefined if anything is off. */
export function parsePlayLogUpload(value: unknown): PlayLogUpload | undefined {
  if (!isRecord(value)) return undefined;
  const attempt = parseAttempt(value);
  const {
    seedCode,
    generatorVersion,
    difficulty,
    outcome,
    endedAt,
    elapsedMs,
    appVersion,
    truncated,
    events,
  } = value;
  if (
    !attempt ||
    !isDifficulty(difficulty) ||
    typeof generatorVersion !== "string" ||
    !isSeedCodeOf(seedCode, generatorVersion, difficulty) ||
    !isPlayOutcome(outcome) ||
    !isCount(endedAt) ||
    endedAt < attempt.startedAt ||
    !isCount(elapsedMs) ||
    typeof appVersion !== "string" ||
    appVersion.length > MAX_APP_VERSION_LENGTH ||
    typeof truncated !== "boolean" ||
    !isEventList(events)
  ) {
    return undefined;
  }
  return {
    ...attempt,
    seedCode,
    generatorVersion,
    difficulty,
    outcome,
    endedAt,
    elapsedMs,
    appVersion,
    truncated,
    events,
  };
}

/** The counts the server keeps beside the log, for quick queries. */
export interface PlayLogSummary {
  /** Moves made by the player: taps, strokes and hint writes. */
  readonly moves: number;
  readonly undos: number;
  readonly resets: number;
  readonly hintSteps: number;
  readonly pauses: number;
  /** The longest gap between two events while the clock ran. */
  readonly longestGapMs: number;
}

const COUNTED_MOVES: readonly MoveSource[] = ["tap", "stroke", "hint"];

export function summarizePlayLog(
  events: readonly PlayLogEvent[],
): PlayLogSummary {
  let moves = 0;
  let undos = 0;
  let resets = 0;
  let hintSteps = 0;
  let pauses = 0;
  let longestGapMs = 0;
  let previous: number | undefined;
  for (const event of events) {
    const [kind, t] = event;
    if (kind === "move") {
      const source = event[2];
      if (COUNTED_MOVES.includes(source)) moves += 1;
      else if (source === "undo") undos += 1;
      else if (source === "reset") resets += 1;
    } else if (kind === "hint") hintSteps += 1;
    else if (kind === "pause") pauses += 1;
    // The clock stops between pause and start, so t does not move there.
    if (previous !== undefined) {
      longestGapMs = Math.max(longestGapMs, t - previous);
    }
    previous = t;
  }
  return { moves, undos, resets, hintSteps, pauses, longestGapMs };
}
