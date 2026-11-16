/**
 * The puzzle being played, the player's marks, the clock and the local
 * records, for the screens. The rules all live in src/core; this only holds
 * the state, calls the core and saves.
 */
import {
  type Ref,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from "vue";
import { annotateBoard } from "../core/annotations";
import { type Attempt, newAttempt, withAssist } from "../core/attempt";
import {
  type Hint,
  type HintStep,
  hintLabel,
  withHintStep,
} from "../core/hint";
import {
  type MoveSource,
  type LoggedNoHintReason,
  type PlayLog,
  type PlayLogEvent,
  type PlayLogUpload,
  type PlayOutcome,
  DAILY_PLAY_LOG_KEY,
  PLAY_LOG_KEY,
  appendEvent,
  changesBetween,
  emptyPlayLog,
  hasEnded,
  loadPlayLog,
  savePlayLog,
} from "../core/play-log";
import { boardGeometry } from "../core/board";
import {
  type CurrentGame,
  loadCurrentGame,
  saveCurrentGame,
} from "../core/current-game";
import { loadDailyGame, saveDailyGame } from "../core/daily";
import { CURRENT_GENERATOR_VERSION } from "../core/generator";
import { type Difficulty, type EdgeState, type Puzzle } from "../core/model";
import {
  type EdgeEdit,
  type PlayBoard,
  type Stroke,
  applyEdits,
  beginStroke as startStroke,
  continueStroke,
  emptyPlayBoard,
  hasMarks,
  redoMove,
  resetMarks,
  tappedState,
  undoMove,
} from "../core/play";
import {
  type PlayTimer,
  WAITING_TIMER,
  elapsedTimerMs,
  elapsedTimerSeconds,
  finishTimer,
  pauseTimer,
  startTimer,
} from "../core/play-timer";
import {
  type ResultHistory,
  finishPlay,
  loadResultHistory,
  saveResultHistory,
  startPlay,
} from "../core/results";
import {
  cellsInsideLoop,
  isSolved,
  lineEdges,
  loopVertices,
} from "../core/rules";
import { pickRankedPuzzle } from "../core/next-puzzle";
import { puzzleId } from "../core/puzzle-identity";
import { type SeedCode, encodeSeedCode } from "../core/seed-code";
import { type Settings } from "../core/settings";
import {
  PuzzleGenerator,
  SupersededError,
  randomSeed,
} from "./puzzle-generation";
import { browserStorage } from "./browser-storage";

/**
 * How often a running clock is saved. Moves, pauses and a hidden page save
 * at once; this only bounds what a crash or a killed tab loses.
 */
const CLOCK_SAVE_MS = 10_000;

/** A UUID; crypto.randomUUID needs a secure context, so fall back. */
function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10),
  ]
    .map((part) => part.join(""))
    .join("-");
}

function seedCodeOf(puzzle: Puzzle): string {
  return encodeSeedCode({
    version: puzzle.generatorVersion,
    difficulty: puzzle.difficulty,
    seed: puzzle.seed,
  });
}

/**
 * The daily challenge on the board (DESIGN.md chapter 25). Its board is saved
 * apart, per ID and date; it never goes into the local records, which are
 * the ordinary boards'.
 */
export interface DailySession {
  readonly account: string;
  readonly date: string;
  readonly puzzleId: string;
  /** Whether the server took the challenge (READY's OK was answered). */
  readonly started: boolean;
}

export interface PlayOptions {
  /** Called once when the player closes the loop; not on a reload. */
  readonly onClear?: () => void;
  /**
   * Called once when an attempt ends, cleared or left unsolved for another
   * board, with its play log to send (DESIGN.md 20.1).
   */
  readonly onPlayLog?: (upload: PlayLogUpload) => void;
  /** The build, sent with the play log. */
  readonly appVersion?: string;
}

export function usePlay(settings: Ref<Settings>, options: PlayOptions = {}) {
  const storage = browserStorage();
  const generator = new PuzzleGenerator();
  const puzzle = shallowRef<Puzzle>();
  const board = shallowRef<PlayBoard>(emptyPlayBoard(0));
  const attempt = shallowRef<Attempt>();
  const timer = shallowRef<PlayTimer>(WAITING_TIMER);
  const history = shallowRef<ResultHistory>(
    loadResultHistory(storage, createId),
  );
  /** Ticks every second while the clock runs, for the time shown. */
  const now = ref(Date.now());
  const loading = ref(false);
  const failure = ref<string>();
  /** Set while the day's board is played instead of an ordinary one. */
  const daily = shallowRef<DailySession>();
  let stroke: Stroke | undefined;
  /** What the player did in this attempt (src/core/play-log.ts). */
  let log: PlayLog = emptyPlayLog("");
  let clock: ReturnType<typeof setInterval> | undefined;
  let lastSaved = 0;
  /** The attempt already in the history as a play. */
  let recordedPlayId: string | undefined;
  /** Only the latest request may replace the board. */
  let latestRequest = 0;
  /**
   * Boards shown in this visit, which a ranked candidate must not repeat;
   * boards of earlier visits are in the history once played.
   */
  const shownSeedCodes = new Set<string>();
  const shownPuzzleIds = new Set<string>();

  const geometry = computed(() => boardGeometry(puzzle.value?.size ?? 7));

  const solved = computed(
    () =>
      puzzle.value !== undefined &&
      isSolved(geometry.value, puzzle.value.clues, board.value.states),
  );

  const running = computed(() => timer.value.status === "running");

  /** Whether the board takes moves now. */
  const playable = computed(
    () =>
      puzzle.value !== undefined &&
      !solved.value &&
      !loading.value &&
      running.value,
  );

  /**
   * Whether READY covers the board. It stays up while the next board is
   * being made too: the clock is stopped, so the board must not be studied.
   */
  const waiting = computed(
    () => puzzle.value !== undefined && timer.value.status === "ready",
  );

  const elapsedSeconds = computed(() =>
    elapsedTimerSeconds(timer.value, now.value),
  );

  // Read apart, so that changing another setting does not derive everything again.
  const assist = computed(() => settings.value.assist);
  const showConflicts = computed(() => settings.value.showConflicts);

  const annotations = computed(() =>
    annotateBoard(
      geometry.value,
      puzzle.value?.clues ?? [],
      board.value.states,
      {
        // A finished board has nothing left to warn about or to assist with.
        showConflicts: showConflicts.value && !solved.value,
        assist: solved.value ? 0 : assist.value,
      },
    ),
  );

  const inside = computed(() =>
    solved.value && puzzle.value
      ? cellsInsideLoop(geometry.value, puzzle.value.solution)
      : undefined,
  );

  /**
   * The finished loop's vertices in walking order, for the snake. Taken from
   * the player's lines, since the snake is drawn in their place.
   */
  const loop = computed(() =>
    solved.value
      ? loopVertices(geometry.value, lineEdges(board.value.states))
      : undefined,
  );

  const seedCode = computed(() =>
    puzzle.value ? seedCodeOf(puzzle.value) : "",
  );

  /** Whether any line or × is on the board, which leaving would lose. */
  const marked = computed(() => hasMarks(board.value));

  const canUndo = computed(() => playable.value && board.value.undo.length > 0);
  const canRedo = computed(() => playable.value && board.value.redo.length > 0);
  const canReset = computed(() => playable.value && marked.value);

  // --- saving ---------------------------------------------------------------

  function saveGame(): void {
    if (!storage || !puzzle.value || !attempt.value) return;
    lastSaved = Date.now();
    const game: CurrentGame = {
      puzzle: puzzle.value,
      attempt: attempt.value,
      board: board.value,
      timer: timer.value,
    };
    const session = daily.value;
    if (session) {
      savePlayLog(storage, log, DAILY_PLAY_LOG_KEY);
      saveDailyGame(storage, session.account, session.date, game, lastSaved);
      return;
    }
    savePlayLog(storage, log, PLAY_LOG_KEY);
    saveCurrentGame(storage, game, lastSaved);
  }

  /**
   * Changes the history as saved now, not as read at startup: another tab
   * may have added plays since, and writing the old copy would drop them.
   */
  function updateHistory(
    change: (history: ResultHistory) => ResultHistory,
  ): void {
    const current = storage
      ? loadResultHistory(storage, () => history.value.userId)
      : history.value;
    const next = change(current);
    if (next !== current && storage) saveResultHistory(storage, next);
    history.value = next;
  }

  function playedPuzzle() {
    return {
      seedCode: seedCode.value,
      generatorVersion: puzzle.value!.generatorVersion,
      difficulty: puzzle.value!.difficulty,
    };
  }

  /** The attempt becomes a play once the board has changed (DESIGN.md 16.1). */
  function recordStart(): void {
    const current = attempt.value;
    // Once per attempt; the board changes on every edge of a stroke.
    if (!current || recordedPlayId === current.playId) return;
    recordedPlayId = current.playId;
    // The day's board is recorded by the server, not in the local records.
    if (daily.value) return;
    updateHistory((saved) => startPlay(saved, playedPuzzle(), current));
  }

  function recordClear(): void {
    const current = attempt.value;
    if (!current) return;
    recordedPlayId = current.playId;
    if (daily.value) return;
    const seconds = elapsedTimerSeconds(timer.value, Date.now());
    updateHistory((saved) =>
      finishPlay(saved, playedPuzzle(), current, Date.now(), seconds),
    );
  }

  // --- the play log -----------------------------------------------------------

  /** Adds an event at the play clock's time now; saved with the game. */
  function logEvent(make: (t: number) => PlayLogEvent): void {
    if (!attempt.value || hasEnded(log)) return;
    log = appendEvent(log, make(elapsedTimerMs(timer.value, Date.now())));
  }

  /**
   * Ends the log and hands it on to be sent. Only an attempt that changed the
   * board is a play (DESIGN.md 16.1, recordStart); a board skipped untouched
   * sends nothing.
   */
  function endLog(outcome: PlayOutcome): void {
    const current = attempt.value;
    if (!current || !puzzle.value || hasEnded(log)) return;
    if (recordedPlayId !== current.playId) return;
    logEvent((t) => ["end", t, outcome]);
    options.onPlayLog?.({
      ...current,
      seedCode: seedCode.value,
      generatorVersion: puzzle.value.generatorVersion,
      difficulty: puzzle.value.difficulty,
      outcome,
      endedAt: Date.now(),
      elapsedMs: elapsedTimerMs(timer.value, Date.now()),
      appVersion: options.appVersion ?? "",
      truncated: log.truncated,
      events: log.events,
    });
  }

  /** The magnified view opened (long press). */
  function noteZoom(): void {
    if (playable.value) logEvent((t) => ["zoom", t]);
  }

  // --- the clock --------------------------------------------------------------

  function setTimer(next: PlayTimer): void {
    timer.value = next;
    now.value = Date.now();
    if (next.status === "running" && clock === undefined) {
      clock = setInterval(() => {
        now.value = Date.now();
        if (now.value - lastSaved >= CLOCK_SAVE_MS) saveGame();
      }, 1000);
    } else if (next.status !== "running" && clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
  }

  /** READY's OK. */
  function start(): void {
    if (!waiting.value || loading.value) return;
    setTimer(startTimer(timer.value, Date.now()));
    logEvent((t) => ["start", t]);
  }

  /** Back to READY; the time so far is kept and saved. */
  function pause(): void {
    if (!running.value) return;
    // The save below takes the stroke so far with it.
    stroke = undefined;
    logEvent((t) => ["pause", t]);
    setTimer(pauseTimer(timer.value, Date.now()));
    saveGame();
  }

  /**
   * The loop closed by a move. Done with the move, not later in a watcher,
   * so the board is never saved solved with the clock still open (a save
   * that would not load back).
   */
  function finish(): void {
    stroke = undefined;
    setTimer(finishTimer(timer.value, Date.now()));
    recordClear();
    endLog("cleared");
    saveGame();
    options.onClear?.();
  }

  watch(assist, (level) => {
    if (!attempt.value || solved.value) return;
    // Before the first OK nothing was played with the old setting yet.
    const unstarted =
      timer.value.status === "ready" && timer.value.elapsedMs === 0;
    attempt.value = unstarted
      ? { ...attempt.value, maxAssist: level }
      : withAssist(attempt.value, level);
    logEvent((t) => ["assist", t, level]);
    saveGame();
  });

  onScopeDispose(() => {
    if (clock !== undefined) clearInterval(clock);
    clock = undefined;
  });

  // --- boards -----------------------------------------------------------------

  /** Picks up the saved board, if there is one. */
  function restore(): boolean {
    const saved = storage && loadCurrentGame(storage);
    if (!saved) return false;
    daily.value = undefined;
    puzzle.value = saved.puzzle;
    board.value = saved.board;
    attempt.value = saved.attempt;
    log = loadPlayLog(storage, saved.attempt.playId);
    setTimer(saved.timer);
    // An attempt already in the history is a play, even with its marks all
    // reset or undone since.
    const { playId } = saved.attempt;
    if (history.value.plays.some((play) => play.playId === playId)) {
      recordedPlayId = playId;
    }
    // Catch up on a play or a clear the history missed (it saves apart).
    if (saved.timer.status === "finished") recordClear();
    else if (marked.value) recordStart();
    return true;
  }

  /**
   * Replaces the board with the one `make` produces; `current` tells it
   * whether a newer request has replaced this one.
   */
  async function begin(
    make: (current: () => boolean) => Promise<Puzzle>,
  ): Promise<boolean> {
    latestRequest += 1;
    const request = latestRequest;
    // Saves the board being left, the day's board in its own place.
    pause();
    const leavingDaily = daily.value !== undefined;
    loading.value = true;
    failure.value = undefined;
    try {
      const next = await make(() => request === latestRequest);
      if (request !== latestRequest) return false;
      shownSeedCodes.add(seedCodeOf(next));
      stroke = undefined;
      // The board being left unsolved: its log goes out as abandoned. The
      // day's board is not abandoned: it is kept and can be taken up again.
      if (!solved.value && !leavingDaily) endLog("abandoned");
      daily.value = undefined;
      puzzle.value = next;
      board.value = emptyPlayBoard(geometry.value.edgeCount);
      attempt.value = newAttempt(createId(), Date.now(), settings.value.assist);
      log = emptyPlayLog(attempt.value.playId);
      setTimer(WAITING_TIMER);
      saveGame();
      return true;
    } catch {
      if (request === latestRequest) failure.value = "問題を作れませんでした";
      return false;
    } finally {
      if (request === latestRequest) loading.value = false;
    }
  }

  function generate(code: SeedCode): Promise<Puzzle> {
    return generator.generate(code.seed, code.difficulty, code.version);
  }

  function load(code: SeedCode): Promise<boolean> {
    return begin(() => generate(code));
  }

  /**
   * A new puzzle at the difficulty. With `candidates` (the device has an
   * ID), a ranked board other players solved comes first (DESIGN.md 13.8);
   * without one, or when none is usable, the device makes a new board.
   */
  function startNew(
    difficulty: Difficulty,
    candidates?: (difficulty: Difficulty) => Promise<unknown>,
  ): Promise<boolean> {
    return begin(async (current) => {
      const ranked =
        candidates &&
        (await pickRankedPuzzle(
          difficulty,
          {
            puzzleIds: shownPuzzleIds,
            seedCodes: new Set([
              ...shownSeedCodes,
              ...history.value.plays.map((play) => play.seedCode),
            ]),
          },
          { fetchCandidates: candidates, generate, identify: puzzleId },
          { next: Math.random },
        ));
      if (ranked) {
        shownPuzzleIds.add(ranked.puzzleId);
        return ranked.puzzle;
      }
      // A newer request took over while the candidates were tried.
      if (!current()) throw new SupersededError();
      return generate({
        version: CURRENT_GENERATOR_VERSION,
        difficulty,
        seed: randomSeed(),
      });
    });
  }

  // --- the daily challenge -----------------------------------------------------

  /** Shows a saved or new game as the board, with its log. */
  function show(game: CurrentGame, logKey: string): void {
    stroke = undefined;
    puzzle.value = game.puzzle;
    board.value = game.board;
    attempt.value = game.attempt;
    log = storage
      ? loadPlayLog(storage, game.attempt.playId, logKey)
      : emptyPlayLog(game.attempt.playId);
    setTimer(game.timer);
  }

  /**
   * Plays the day's board instead of the ordinary one, which is saved and
   * comes back with leaveDaily. The board left on this device for the ID and
   * date is taken up again; `playId` is the challenge the server holds, if
   * any, and a saved board of another attempt is not used for it.
   */
  function enterDaily(
    session: Omit<DailySession, "started">,
    next: Puzzle,
    playId?: string,
  ): void {
    // A board being made for the ordinary game is not wanted any more.
    latestRequest += 1;
    loading.value = false;
    failure.value = undefined;
    pause();
    daily.value = { ...session, started: playId !== undefined };
    const saved =
      storage && loadDailyGame(storage, session.account, session.date);
    if (
      saved &&
      saved.puzzle.clues.join() === next.clues.join() &&
      (playId === undefined || saved.attempt.playId === playId)
    ) {
      show(saved, DAILY_PLAY_LOG_KEY);
      // Its first move made it a play, for the log (recordStart).
      recordedPlayId =
        hasMarks(saved.board) || saved.timer.status === "finished"
          ? saved.attempt.playId
          : undefined;
    } else {
      show(
        {
          puzzle: next,
          board: emptyPlayBoard(boardGeometry(next.size).edgeCount),
          attempt: newAttempt(
            playId ?? createId(),
            Date.now(),
            settings.value.assist,
          ),
          timer: WAITING_TIMER,
        },
        DAILY_PLAY_LOG_KEY,
      );
      recordedPlayId = undefined;
    }
    saveGame();
  }

  /** The server took the day's challenge: READY's OK may run the clock. */
  function markDailyStarted(): void {
    if (daily.value) daily.value = { ...daily.value, started: true };
  }

  /**
   * Back from the day's board (kept as it is) to the ordinary one. False
   * when there was no ordinary board to come back to.
   */
  function leaveDaily(): boolean {
    if (!daily.value) return true;
    latestRequest += 1;
    loading.value = false;
    pause();
    daily.value = undefined;
    stroke = undefined;
    if (restore()) return true;
    // Nothing to come back to: the day's board must not be saved as the
    // ordinary one, so it goes until the caller starts a new board.
    puzzle.value = undefined;
    attempt.value = undefined;
    setTimer(WAITING_TIMER);
    return false;
  }

  // --- moves ------------------------------------------------------------------

  /**
   * Shows a move, and logs the edges it changed with what made it (every
   * change to the board passes here, so the log misses none). `save` is off
   * while a stroke is still going.
   */
  function setBoard(next: PlayBoard, source: MoveSource, save = true): void {
    if (next === board.value) return;
    const changes = changesBetween(board.value.states, next.states);
    if (changes.length > 0) logEvent((t) => ["move", t, source, changes]);
    board.value = next;
    recordStart();
    if (solved.value) finish();
    else if (save) saveGame();
  }

  function tap(edge: number): void {
    if (!playable.value) return;
    const current = board.value.states[edge] as EdgeState;
    setBoard(
      applyEdits(board.value, [{ edge, after: tappedState(current) }]),
      "tap",
    );
  }

  function beginStroke(): void {
    stroke = playable.value ? startStroke(board.value) : undefined;
  }

  /** Adds the edges a stroke passed; the whole stroke stays one move. */
  function strokeEdges(edges: readonly number[]): void {
    if (!stroke || !playable.value) return;
    // Until the stroke changes an edge, the board is still its base.
    const first = board.value === stroke.base;
    const next = continueStroke(stroke, edges);
    stroke = next.stroke;
    setBoard(next.board, first ? "stroke" : "stroke-more", false);
  }

  function endStroke(): void {
    if (stroke && stroke.edits.length > 0) saveGame();
    stroke = undefined;
  }

  function undo(): void {
    if (canUndo.value) setBoard(undoMove(board.value), "undo");
  }

  function redo(): void {
    if (canRedo.value) setBoard(redoMove(board.value), "redo");
  }

  /** Clears the marks; the attempt, clock and records go on (DESIGN.md 16.4). */
  function reset(): void {
    if (canReset.value) setBoard(resetMarks(board.value), "reset");
  }

  // --- hints ------------------------------------------------------------------

  function recordHintStep(hint: Hint, step: HintStep): void {
    if (!attempt.value || !playable.value) return;
    attempt.value = withHintStep(attempt.value, hint, step);
    logEvent((t) => ["hint", t, step, hintLabel(hint)]);
    saveGame();
  }

  /**
   * The hint button found nothing (issue #5): logged with why, to find
   * boards where it happens. Not a hint, so the hint count stays.
   */
  function recordNoHint(reason: LoggedNoHintReason): void {
    if (!attempt.value || !playable.value) return;
    logEvent((t) => ["no-hint", t, reason]);
    // The log lives in storage beside the game: a reload keeps the event.
    saveGame();
  }

  /** A hint's step 3: one move, which undo takes back (DESIGN.md 11.2). */
  function applyHint(edits: readonly EdgeEdit[]): void {
    if (playable.value) setBoard(applyEdits(board.value, edits), "hint");
  }

  return {
    puzzle,
    board,
    geometry,
    annotations,
    inside,
    loop,
    solved,
    playable,
    waiting,
    running,
    attempt,
    history,
    elapsedSeconds,
    seedCode,
    marked,
    canUndo,
    canRedo,
    canReset,
    loading,
    failure,
    daily,
    restore,
    enterDaily,
    markDailyStarted,
    leaveDaily,
    recordHintStep,
    recordNoHint,
    applyHint,
    load,
    startNew,
    start,
    pause,
    tap,
    beginStroke,
    strokeEdges,
    endStroke,
    undo,
    redo,
    reset,
    noteZoom,
  };
}
