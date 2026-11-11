/**
 * The puzzle being played and the player's marks, for the screens. The rules
 * all live in src/core; this only holds the state and calls the core.
 */
import { type Ref, computed, ref, shallowRef } from "vue";
import { annotateBoard } from "../core/annotations";
import { boardGeometry } from "../core/board";
import { CURRENT_GENERATOR_VERSION } from "../core/generator";
import { type Difficulty, type EdgeState, type Puzzle } from "../core/model";
import {
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
import { cellsInsideLoop, isSolved } from "../core/rules";
import { type SeedCode, encodeSeedCode } from "../core/seed-code";
import { type Settings } from "../core/settings";
import { PuzzleGenerator, randomSeed } from "./puzzle-generation";

export function usePlay(settings: Ref<Settings>) {
  const generator = new PuzzleGenerator();
  const puzzle = shallowRef<Puzzle>();
  const board = shallowRef<PlayBoard>(emptyPlayBoard(0));
  const loading = ref(false);
  const failure = ref<string>();
  let stroke: Stroke | undefined;
  /** Only the latest request may replace the board. */
  let latestRequest = 0;

  const geometry = computed(() => boardGeometry(puzzle.value?.size ?? 7));

  const solved = computed(
    () =>
      puzzle.value !== undefined &&
      isSolved(geometry.value, puzzle.value.clues, board.value.states),
  );

  /** Whether the board takes moves now. */
  const playable = computed(
    () => puzzle.value !== undefined && !solved.value && !loading.value,
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

  async function load(code: SeedCode): Promise<boolean> {
    latestRequest += 1;
    const request = latestRequest;
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

  function tap(edge: number): void {
    if (!playable.value) return;
    const current = board.value.states[edge] as EdgeState;
    board.value = applyEdits(board.value, [
      { edge, after: tappedState(current, settings.value.tool) },
    ]);
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
    board.value = next.board;
  }

  function endStroke(): void {
    stroke = undefined;
  }

  function undo(): void {
    if (canUndo.value) board.value = undoMove(board.value);
  }

  function redo(): void {
    if (canRedo.value) board.value = redoMove(board.value);
  }

  function reset(): void {
    if (canReset.value) board.value = resetMarks(board.value);
  }

  return {
    puzzle,
    board,
    geometry,
    annotations,
    inside,
    solved,
    playable,
    seedCode,
    marked,
    canUndo,
    canRedo,
    canReset,
    loading,
    failure,
    load,
    startNew,
    tap,
    beginStroke,
    strokeEdges,
    endStroke,
    undo,
    redo,
    reset,
  };
}
