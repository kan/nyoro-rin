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
import { type Hint, type HintStep, withHintStep } from "../core/hint";
import { boardGeometry } from "../core/board";
import { loadCurrentGame, saveCurrentGame } from "../core/current-game";
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
import { type SeedCode, encodeSeedCode } from "../core/seed-code";
import { type Settings } from "../core/settings";
import { PuzzleGenerator, randomSeed } from "./puzzle-generation";
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

export interface PlayOptions {
  /** Called once when the player closes the loop; not on a reload. */
  readonly onClear?: () => void;
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
  let stroke: Stroke | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let lastSaved = 0;
  /** The attempt already in the history as a play. */
  let recordedPlayId: string | undefined;
  /** Only the latest request may replace the board. */
  let latestRequest = 0;

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

  // Read apart, so that switching the tool does not derive everything again.
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
    puzzle.value
      ? encodeSeedCode({
          version: puzzle.value.generatorVersion,
          difficulty: puzzle.value.difficulty,
          seed: puzzle.value.seed,
        })
      : "",
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
    saveCurrentGame(
      storage,
      {
        puzzle: puzzle.value,
        attempt: attempt.value,
        board: board.value,
        timer: timer.value,
      },
      lastSaved,
    );
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
    updateHistory((saved) => startPlay(saved, playedPuzzle(), current));
  }

  function recordClear(): void {
    const current = attempt.value;
    if (!current) return;
    recordedPlayId = current.playId;
    const seconds = elapsedTimerSeconds(timer.value, Date.now());
    updateHistory((saved) =>
      finishPlay(saved, playedPuzzle(), current, Date.now(), seconds),
    );
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
  }

  /** Back to READY; the time so far is kept and saved. */
  function pause(): void {
    if (!running.value) return;
    // The save below takes the stroke so far with it.
    stroke = undefined;
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
    puzzle.value = saved.puzzle;
    board.value = saved.board;
    attempt.value = saved.attempt;
    setTimer(saved.timer);
    // Catch up on a play or a clear the history missed (it saves apart).
    if (saved.timer.status === "finished") recordClear();
    else if (marked.value) recordStart();
    return true;
  }

  async function load(code: SeedCode): Promise<boolean> {
    latestRequest += 1;
    const request = latestRequest;
    pause();
    loading.value = true;
    failure.value = undefined;
    try {
      const next = await generator.generate(
        code.seed,
        code.difficulty,
        code.version,
      );
      if (request !== latestRequest) return false;
      stroke = undefined;
      puzzle.value = next;
      board.value = emptyPlayBoard(geometry.value.edgeCount);
      attempt.value = newAttempt(createId(), Date.now(), settings.value.assist);
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

  function startNew(difficulty: Difficulty): Promise<boolean> {
    return load({
      version: CURRENT_GENERATOR_VERSION,
      difficulty,
      seed: randomSeed(),
    });
  }

  // --- moves ------------------------------------------------------------------

  /** Shows a move; `save` is off while a stroke is still going. */
  function setBoard(next: PlayBoard, save = true): void {
    if (next === board.value) return;
    board.value = next;
    recordStart();
    if (solved.value) finish();
    else if (save) saveGame();
  }

  function tap(edge: number): void {
    if (!playable.value) return;
    const current = board.value.states[edge] as EdgeState;
    setBoard(
      applyEdits(board.value, [
        { edge, after: tappedState(current, settings.value.tool) },
      ]),
    );
  }

  function beginStroke(): void {
    stroke = playable.value
      ? startStroke(board.value, settings.value.tool)
      : undefined;
  }

  /** Adds the edges a stroke passed; the whole stroke stays one move. */
  function strokeEdges(edges: readonly number[]): void {
    if (!stroke || !playable.value) return;
    const next = continueStroke(stroke, edges);
    stroke = next.stroke;
    setBoard(next.board, false);
  }

  function endStroke(): void {
    if (stroke && stroke.edits.length > 0) saveGame();
    stroke = undefined;
  }

  function undo(): void {
    if (canUndo.value) setBoard(undoMove(board.value));
  }

  function redo(): void {
    if (canRedo.value) setBoard(redoMove(board.value));
  }

  /** Clears the marks; the attempt, clock and records go on (DESIGN.md 16.4). */
  function reset(): void {
    if (canReset.value) setBoard(resetMarks(board.value));
  }

  // --- hints ------------------------------------------------------------------

  function recordHintStep(hint: Hint, step: HintStep): void {
    if (!attempt.value || !playable.value) return;
    attempt.value = withHintStep(attempt.value, hint, step);
    saveGame();
  }

  /** A hint's step 3: one move, which undo takes back (DESIGN.md 11.2). */
  function applyHint(edits: readonly EdgeEdit[]): void {
    if (playable.value) setBoard(applyEdits(board.value, edits));
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
    restore,
    recordHintStep,
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
  };
}
