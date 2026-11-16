/**
 * The pointer on the board (DESIGN.md 7.2-7.4): taps with their preview,
 * strokes, the long press that magnifies and moving the magnified view.
 * What the edges become is the caller's: the play screen and the tutorial
 * share this, so that the two never handle a finger differently.
 */
import { type Ref, computed, ref } from "vue";
import { type BoardGeometry } from "../core/board";
import { type EdgeState, type EdgeStates } from "../core/model";
import { tappedState } from "../core/play";
import { type BoardPointerEvent, type TapPreview } from "./BoardView.vue";
import {
  LONG_PRESS_MS,
  type BoardPoint,
  type ZoomWindow,
  panZoomWindow,
  zoomWindowAt,
} from "./board-input";
import { BoardGesture } from "./gesture";
import { requestVibration } from "./vibration";

export interface BoardInputTarget {
  readonly geometry: Readonly<Ref<BoardGeometry>>;
  readonly states: Readonly<Ref<EdgeStates>>;
  /** Whether the board takes marks now. */
  readonly playable: Readonly<Ref<boolean>>;
  readonly haptics?: Readonly<Ref<boolean>>;
  tap(edge: number): void;
  beginStroke(): void;
  strokeEdges(edges: readonly number[]): void;
  endStroke(): void;
  /** Whether a long press magnifies (DESIGN.md 7.4). */
  readonly zoomable: boolean;
  /** Any press, even one the board does not take. */
  onPress?(): void;
  /** The view was magnified. */
  onZoom?(): void;
}

export function useBoardInput(target: BoardInputTarget) {
  const zoom = ref<ZoomWindow>();
  let gesture: BoardGesture | undefined;
  let gestureInZoom = false;
  /** The edge the press would tap, shown pale until it is released. */
  const tapEdge = ref<number>();
  /** What the tap would make of it, from the board as it is now. */
  const tapPreview = computed<TapPreview | undefined>(() => {
    const edge = tapEdge.value;
    if (edge === undefined) return undefined;
    const current = target.states.value[edge] as EdgeState;
    return { edge, after: tappedState(current) };
  });
  let pan: { clientX: number; clientY: number; window: ZoomWindow } | undefined;
  let longPress: ReturnType<typeof setTimeout> | undefined;

  function stopLongPress(): void {
    if (longPress !== undefined) clearTimeout(longPress);
    longPress = undefined;
  }

  function endGesture(): void {
    stopLongPress();
    target.endStroke();
    gesture = undefined;
    pan = undefined;
    tapEdge.value = undefined;
  }

  function onPress(event: BoardPointerEvent, inZoom: boolean): void {
    target.onPress?.();
    if (!target.playable.value) return;
    stopLongPress();
    gesture = new BoardGesture(target.geometry.value, event.point, { inZoom });
    gestureInZoom = inZoom;
    tapEdge.value = gesture.tapEdge;
    pan = undefined;
    if (gesture.kind === "pan" && zoom.value) {
      pan = {
        clientX: event.clientX,
        clientY: event.clientY,
        window: zoom.value,
      };
    } else if (gesture.kind !== "tap") {
      target.beginStroke();
    }
    if (!inZoom && target.zoomable) {
      const start = event.point;
      longPress = setTimeout(() => openZoom(start), LONG_PRESS_MS);
    }
  }

  function onDrag(event: BoardPointerEvent, inZoom: boolean): void {
    if (!gesture || inZoom !== gestureInZoom) return;
    const edges = gesture.move(event.point);
    if (gesture.hasMoved) {
      stopLongPress();
      tapEdge.value = undefined;
    }
    if (pan && gesture.hasMoved) {
      zoom.value = panZoomWindow(
        target.geometry.value,
        pan.window,
        (event.clientX - pan.clientX) * event.unitsPerPixel,
        (event.clientY - pan.clientY) * event.unitsPerPixel,
      );
    } else if (edges.length > 0) {
      target.strokeEdges(edges);
    }
  }

  function onRelease(inZoom: boolean): void {
    if (!gesture || inZoom !== gestureInZoom) return;
    const tapped = gesture.release();
    endGesture();
    if (tapped !== undefined) target.tap(tapped);
  }

  function onCancel(inZoom: boolean): void {
    if (inZoom === gestureInZoom) endGesture();
  }

  /** The pointer handlers of one of the two boards. */
  function boardHandlers(inZoom: boolean) {
    return {
      onPress: (event: BoardPointerEvent) => onPress(event, inZoom),
      onDrag: (event: BoardPointerEvent) => onDrag(event, inZoom),
      onRelease: () => onRelease(inZoom),
      onCancel: () => onCancel(inZoom),
    };
  }

  /** Long press: magnify around the press (DESIGN.md 7.4). */
  function openZoom(center: BoardPoint): void {
    longPress = undefined;
    if (!gesture || gesture.hasMoved) return;
    endGesture();
    zoom.value = zoomWindowAt(target.geometry.value, center);
    target.onZoom?.();
    if (target.haptics?.value) requestVibration(12);
  }

  function closeZoom(): void {
    zoom.value = undefined;
    onCancel(true);
  }

  return {
    zoom,
    tapPreview,
    mainBoardHandlers: boardHandlers(false),
    zoomBoardHandlers: boardHandlers(true),
    endGesture,
    closeZoom,
  };
}
