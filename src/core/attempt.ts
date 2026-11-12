import { type AssistLevel, isAssistLevel } from "./settings";

/**
 * How far a hint was opened (DATA_CONTRACT.md 「段階と記録の値」): 0 for
 * none, 1-3 for focus, reason and apply. Narrowing down a mistake uses the
 * same 1-3.
 */
export type HintStage = 0 | 1 | 2 | 3;

export function isHintStage(value: unknown): value is HintStage {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/**
 * One try at a puzzle and what it used, recorded with the clear
 * (DESIGN.md 16.1). A reset keeps the attempt; only a new board starts one.
 */
export interface Attempt {
  /** A UUID; the key of the local result and of the upload. */
  readonly playId: string;
  /** When the board was first shown, in epoch milliseconds. */
  readonly startedAt: number;
  readonly hintsUsed: number;
  /** Only ever raised. */
  readonly maxHintStage: HintStage;
  /** Only ever raised; starts at the setting the attempt began with. */
  readonly maxAssist: AssistLevel;
  /** Lines shown outright (DESIGN.md 11.4); also counted in hintsUsed. */
  readonly reveals: number;
}

export function newAttempt(
  playId: string,
  startedAt: number,
  assist: AssistLevel,
): Attempt {
  return {
    playId,
    startedAt,
    hintsUsed: 0,
    maxHintStage: 0,
    maxAssist: assist,
    reveals: 0,
  };
}

/** Records a change of the assist setting during the attempt. */
export function withAssist(attempt: Attempt, assist: AssistLevel): Attempt {
  return assist > attempt.maxAssist
    ? { ...attempt, maxAssist: assist }
    : attempt;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPlayId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isTimestamp(value: unknown): value is number {
  return isCount(value);
}

/** Checks the attempt fields of a saved record; undefined if any is off. */
export function parseAttempt(
  value: Readonly<Record<string, unknown>>,
): Attempt | undefined {
  const { playId, startedAt, hintsUsed, maxHintStage, maxAssist, reveals } =
    value;
  if (
    !isPlayId(playId) ||
    !isTimestamp(startedAt) ||
    !isCount(hintsUsed) ||
    !isHintStage(maxHintStage) ||
    !isAssistLevel(maxAssist) ||
    !isCount(reveals) ||
    reveals > hintsUsed
  ) {
    return undefined;
  }
  return { playId, startedAt, hintsUsed, maxHintStage, maxAssist, reveals };
}
