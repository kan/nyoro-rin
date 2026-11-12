/**
 * The clear history kept on the device (DESIGN.md 16.1, DATA_CONTRACT.md
 * 「ローカル保存と版」) and the local records made from it.
 */
import {
  type Attempt,
  isCount,
  isPlayId,
  isTimestamp,
  parseAttempt,
} from "./attempt";
import { type Difficulty, isDifficulty } from "./model";
import { parseSeedCode } from "./seed-code";
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const RESULTS_KEY = "nyoro-rin.results.v1";
export const USER_ID_KEY = "nyoro-rin.user-id";

interface PlayBase {
  readonly playId: string;
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: Difficulty;
  readonly startedAt: number;
}

/**
 * An attempt enters the history when the player first changes the board,
 * so a board skipped untouched is not a play (DESIGN.md 16.1).
 */
export interface PlayInProgress extends PlayBase {
  readonly status: "in-progress";
}

export interface CompletedPlay extends PlayBase, Omit<Attempt, "playId"> {
  readonly status: "completed";
  readonly completedAt: number;
  readonly elapsedSeconds: number;
}

export type PlayResult = PlayInProgress | CompletedPlay;

export interface ResultHistory {
  readonly version: 1;
  /** The local anonymous ID; not an account and proves nothing. */
  readonly userId: string;
  /** Oldest first. */
  readonly plays: readonly PlayResult[];
}

/** What a play needs to know about its puzzle. */
export interface PlayedPuzzle {
  readonly seedCode: string;
  readonly generatorVersion: string;
  readonly difficulty: Difficulty;
}

export function emptyHistory(userId: string): ResultHistory {
  return { version: 1, userId, plays: [] };
}

function hasPlay(history: ResultHistory, playId: string): boolean {
  return history.plays.some((play) => play.playId === playId);
}

/** The record of a cleared attempt, if it was cleared. */
export function completedPlay(
  history: ResultHistory,
  playId: string | undefined,
): CompletedPlay | undefined {
  return history.plays.find(
    (play): play is CompletedPlay =>
      play.playId === playId && play.status === "completed",
  );
}

/** Adds the attempt as a play; an attempt already there is left alone. */
export function startPlay(
  history: ResultHistory,
  puzzle: PlayedPuzzle,
  attempt: Pick<Attempt, "playId" | "startedAt">,
): ResultHistory {
  if (hasPlay(history, attempt.playId)) return history;
  const play: PlayInProgress = {
    playId: attempt.playId,
    seedCode: puzzle.seedCode,
    generatorVersion: puzzle.generatorVersion,
    difficulty: puzzle.difficulty,
    startedAt: attempt.startedAt,
    status: "in-progress",
  };
  return { ...history, plays: [...history.plays, play] };
}

/**
 * Records the clear. A play already completed stays as it was, so a reload
 * of a cleared board does not record it twice (DESIGN.md 16.1). A clear
 * without a play (the board was solved before the history could be saved)
 * is added here.
 */
export function finishPlay(
  history: ResultHistory,
  puzzle: PlayedPuzzle,
  attempt: Attempt,
  completedAt: number,
  elapsedSeconds: number,
): ResultHistory {
  const existing = history.plays.find((play) => play.playId === attempt.playId);
  if (existing?.status === "completed") return history;
  const started = startPlay(history, puzzle, attempt);
  return {
    ...started,
    plays: started.plays.map((play) =>
      play.playId === attempt.playId
        ? {
            ...play,
            ...attempt,
            status: "completed" as const,
            completedAt,
            elapsedSeconds,
          }
        : play,
    ),
  };
}

// --- score and records ------------------------------------------------------

export const BASE_SCORE = 10_000;
export const HINT_PENALTY = 30;

/** DESIGN.md 16.2. */
export function score(
  play: Pick<CompletedPlay, "elapsedSeconds" | "hintsUsed">,
): number {
  return BASE_SCORE - play.elapsedSeconds - HINT_PENALTY * play.hintsUsed;
}

/** Better first: score, then time, then hints (DESIGN.md 16.2). */
export function compareCompletedPlays(
  a: CompletedPlay,
  b: CompletedPlay,
): number {
  return (
    score(b) - score(a) ||
    a.elapsedSeconds - b.elapsedSeconds ||
    a.hintsUsed - b.hintsUsed
  );
}

export interface DifficultySummary {
  readonly difficulty: Difficulty;
  /** Attempts in the history, cleared or not. */
  readonly plays: number;
  readonly clears: number;
  readonly averageSeconds?: number;
  readonly averageHints?: number;
  readonly best?: CompletedPlay;
}

export function summarize(
  history: ResultHistory,
  difficulty: Difficulty,
): DifficultySummary {
  const plays = history.plays.filter((play) => play.difficulty === difficulty);
  const clears = plays.filter(
    (play): play is CompletedPlay => play.status === "completed",
  );
  const average = (value: (play: CompletedPlay) => number) =>
    clears.length === 0
      ? undefined
      : clears.reduce((sum, play) => sum + value(play), 0) / clears.length;
  return {
    difficulty,
    plays: plays.length,
    clears: clears.length,
    averageSeconds: average((play) => play.elapsedSeconds),
    averageHints: average((play) => play.hintsUsed),
    best: clears.reduce<CompletedPlay | undefined>(
      (best, play) =>
        !best || compareCompletedPlays(play, best) < 0 ? play : best,
      undefined,
    ),
  };
}

/** The newest plays first. */
export function recentPlays(
  history: ResultHistory,
  difficulty: Difficulty,
  limit: number,
): PlayResult[] {
  return history.plays
    .filter((play) => play.difficulty === difficulty)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

// --- storage ---------------------------------------------------------------

function parsePlay(value: unknown): PlayResult | undefined {
  if (!isRecord(value)) return undefined;
  const { playId, seedCode, generatorVersion, difficulty, startedAt, status } =
    value;
  if (
    !isPlayId(playId) ||
    typeof seedCode !== "string" ||
    typeof generatorVersion !== "string" ||
    !isDifficulty(difficulty) ||
    !isTimestamp(startedAt)
  ) {
    return undefined;
  }
  const code = parseSeedCode(seedCode);
  if (
    !code ||
    code.version !== generatorVersion ||
    code.difficulty !== difficulty
  ) {
    return undefined;
  }
  const base = { playId, seedCode, generatorVersion, difficulty, startedAt };
  if (status === "in-progress") return { ...base, status };
  if (status !== "completed") return undefined;
  const attempt = parseAttempt(value);
  const { completedAt, elapsedSeconds } = value;
  if (
    !attempt ||
    attempt.playId !== playId ||
    attempt.startedAt !== startedAt ||
    !isTimestamp(completedAt) ||
    !isCount(elapsedSeconds)
  ) {
    return undefined;
  }
  return { ...base, ...attempt, status, completedAt, elapsedSeconds };
}

function parseHistory(value: unknown): ResultHistory | undefined {
  if (!isRecord(value)) return undefined;
  const { version, userId, plays } = value;
  if (version !== 1 || !isUserId(userId) || !Array.isArray(plays)) {
    return undefined;
  }
  const parsed: PlayResult[] = [];
  const ids = new Set<string>();
  for (const item of plays) {
    const play = parsePlay(item);
    if (!play || ids.has(play.playId)) return undefined;
    ids.add(play.playId);
    parsed.push(play);
  }
  return { version: 1, userId, plays: parsed };
}

/**
 * The history with the anonymous local user ID, both made on first use.
 * The history's own ID wins over a separately saved one, so its plays keep
 * their owner. Without storage both last only for this session.
 */
export function loadResultHistory(
  storage: KeyValueStorage | undefined,
  createId: () => string,
): ResultHistory {
  const history = storage && readJson(storage, RESULTS_KEY, parseHistory);
  const savedId = storage && readUserId(storage);
  const userId = history?.userId ?? savedId ?? createId();
  if (storage && savedId !== userId) {
    try {
      storage.setItem(USER_ID_KEY, userId);
    } catch {
      // Play goes on; the ID just does not outlive the session.
    }
  }
  return history ?? emptyHistory(userId);
}

export function saveResultHistory(
  storage: KeyValueStorage,
  history: ResultHistory,
): boolean {
  return writeJson(storage, RESULTS_KEY, history);
}

function isUserId(value: unknown): value is string {
  return isPlayId(value);
}

function readUserId(storage: KeyValueStorage): string | undefined {
  try {
    const saved = storage.getItem(USER_ID_KEY);
    return isUserId(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}
