/// <reference lib="webworker" />
/**
 * Works out the daily board off the main thread: a 10 × 10 board takes the
 * complete solver about a second, twice (the solution, then the puzzle ID),
 * which would freeze the screen at the calendar button.
 */
import {
  type DailyBoard,
  dailyPuzzleFromBoard,
  parseDailyBoard,
} from "../core/daily";
import type { Clue } from "../core/model";
import type { DailyRequest, DailyResponse } from "./daily-board";

declare const self: DedicatedWorkerGlobalScope;

/** A clue as one of the constants, not the value that came in. */
function ownClue(clue: Clue): Clue {
  if (clue === 0) return 0;
  if (clue === 1) return 1;
  if (clue === 2) return 2;
  if (clue === 3) return 3;
  return null;
}

/**
 * The board of a message, checked as the API's answer is, and its clues made
 * anew. Only the page that started this worker can post to it, but the
 * solver indexes arrays by the clues, so none of them is taken as it came.
 */
function boardOf(message: unknown): DailyBoard | undefined {
  const board =
    typeof message === "object" && message !== null && "board" in message
      ? parseDailyBoard(message.board)
      : undefined;
  return board && { ...board, clues: board.clues.map(ownClue) };
}

self.onmessage = async (event: MessageEvent<DailyRequest>) => {
  let response: DailyResponse;
  try {
    const board = boardOf(event.data);
    response = board
      ? { puzzle: await dailyPuzzleFromBoard(board) }
      : { error: "Not a daily board." };
  } catch (error) {
    response = { error: String(error) };
  }
  self.postMessage(response);
};
