/// <reference lib="webworker" />
/**
 * Works out the daily board off the main thread: a 10 × 10 board takes the
 * complete solver about a second, twice (the solution, then the puzzle ID),
 * which would freeze the screen at the calendar button.
 */
import { dailyPuzzleFromBoard } from "../core/daily";
import type { DailyRequest, DailyResponse } from "./daily-board";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<DailyRequest>) => {
  let response: DailyResponse;
  try {
    response = { puzzle: await dailyPuzzleFromBoard(event.data.board) };
  } catch (error) {
    response = { error: String(error) };
  }
  self.postMessage(response);
};
