import {
  boardGeometry,
  cellIndex,
  horizontalEdge,
  verticalEdge,
} from "../src/core/board";
import { type Clue, type EdgeStates } from "../src/core/model";
import { statesFromLines } from "../src/core/rules";
import { type KeyValueStorage } from "../src/core/storage";

/** A Map-backed stand-in for localStorage; `map` shows what was written. */
export function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  const storage: KeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
  return { storage, map };
}

export const SIZE = 7;
export const geometry = boardGeometry(SIZE);

/** Edge names for tests: "h r c" is horizontalEdge(r, c), "v r c" verticalEdge(r, c). */
export function edge(name: string): number {
  const [kind, r, c] = name.split(" ");
  return kind === "h"
    ? horizontalEdge(SIZE, Number(r), Number(c))
    : verticalEdge(SIZE, Number(r), Number(c));
}

export function edges(...names: string[]): number[] {
  return names.map(edge);
}

export function cell(row: number, col: number): number {
  return cellIndex(SIZE, row, col);
}

/** A board with these clues and nothing else. */
export function cluesAt(
  entries: readonly [row: number, col: number, clue: Clue][],
): Clue[] {
  const clues: Clue[] = new Array(SIZE * SIZE).fill(null);
  for (const [row, col, clue] of entries) clues[cell(row, col)] = clue;
  return clues;
}

export function states(
  lines: readonly number[] = [],
  crosses: readonly number[] = [],
): EdgeStates {
  return statesFromLines(geometry, lines, crosses);
}

/** The loop around the rectangle of cells rows r0..r1, cols c0..c1. */
export function rectangleLoop(
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): number[] {
  const loop: number[] = [];
  for (let c = c0; c <= c1; c += 1) {
    loop.push(horizontalEdge(SIZE, r0, c), horizontalEdge(SIZE, r1 + 1, c));
  }
  for (let r = r0; r <= r1; r += 1) {
    loop.push(verticalEdge(SIZE, r, c0), verticalEdge(SIZE, r, c1 + 1));
  }
  return loop.sort((a, b) => a - b);
}
