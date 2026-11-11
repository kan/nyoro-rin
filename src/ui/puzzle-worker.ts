/// <reference lib="webworker" />
/**
 * Generates boards off the main thread (DESIGN.md 13.5), so a hard board
 * does not freeze the screen on a slow phone.
 */
import { generatePuzzle } from "../core/generator";
import type {
  GenerationRequest,
  GenerationResponse,
} from "./puzzle-generation";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<GenerationRequest>) => {
  const { id, seed, difficulty, version } = event.data;
  let response: GenerationResponse;
  try {
    response = {
      id,
      puzzle: generatePuzzle(seed, difficulty, { version }).puzzle,
    };
  } catch (error) {
    response = { id, error: String(error) };
  }
  self.postMessage(response);
};
