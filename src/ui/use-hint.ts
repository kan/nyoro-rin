/**
 * The hint on screen and its step (DESIGN.md 11.2). Finding, writing and
 * recording a hint are the core's (src/core/hint.ts); this only steps
 * through it.
 */
import { computed, ref, shallowRef, watch } from "vue";
import {
  type Hint,
  type HintStep,
  nextHintStep,
  searchHint,
} from "../core/hint";
import { type HintMarks, hintMarks, hintText } from "./hint-view";
import { type usePlay } from "./use-play";

interface ShownHint {
  /** Undefined when no hint was found. */
  readonly hint?: Hint;
  readonly step: HintStep;
}

export function useHint(play: ReturnType<typeof usePlay>) {
  const shown = shallowRef<ShownHint>();
  const open = ref(false);

  // A hint is for the board it was found on; any move ends it, its own
  // step 3 included.
  watch([play.board, play.puzzle], () => {
    shown.value = undefined;
    open.value = false;
  });

  // Nothing to hint once the board is solved or waits on READY.
  watch(play.playable, (playable) => {
    if (!playable) open.value = false;
  });

  /** The step on screen; undefined when no hint was found. */
  const step = computed(() =>
    shown.value?.hint ? shown.value.step : undefined,
  );

  /** The step the hint button goes to next, if any. */
  const following = computed(() => {
    const hint = shown.value?.hint;
    return hint ? nextHintStep(hint, shown.value!.step) : undefined;
  });

  const hasNext = computed(() => following.value !== undefined);

  /** Whether the next step writes the hint onto the board. */
  const nextWrites = computed(() => (following.value?.edits.length ?? 0) > 0);

  const text = computed(() => {
    const current = shown.value;
    const puzzle = play.puzzle.value;
    if (!current || !puzzle) return "";
    return hintText(current.hint, current.step, puzzle.clues);
  });

  const marks = computed<HintMarks | undefined>(() =>
    open.value && shown.value?.hint
      ? hintMarks(shown.value.hint, shown.value.step)
      : undefined,
  );

  /**
   * The hint button: the next step of the open hint, the hint closed
   * before (at the step it was at, so reopening is not another hint), or a
   * new hint.
   */
  function request(): void {
    if (!play.playable.value) return;
    if (shown.value) {
      if (open.value) next();
      else open.value = true;
      return;
    }
    const { hint, reason } = searchHint(
      play.geometry.value,
      play.puzzle.value!,
      play.board.value.states,
    );
    shown.value = { hint, step: 1 };
    open.value = true;
    if (hint) play.recordHintStep(hint, 1);
    // A solved board is not playable, so it never gets here.
    else if (reason !== "SOLVED") play.recordNoHint(reason);
  }

  function next(): void {
    const hint = shown.value?.hint;
    const next = following.value;
    if (!hint || !next || !play.playable.value) return;
    play.recordHintStep(hint, next.step);
    if (next.edits.length > 0) play.applyHint(next.edits);
    else shown.value = { hint, step: next.step };
  }

  function close(): void {
    open.value = false;
  }

  return { open, step, text, marks, hasNext, nextWrites, request, next, close };
}
