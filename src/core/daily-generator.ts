/**
 * Makes the daily board (DESIGN.md 25.2). Only the server calls this: the
 * seed comes from a secret, so that nobody can make a future day's board
 * from the public code ahead of time (kan/nyoro-rin#7).
 */
import { DAILY_DIFFICULTY, DAILY_VERSION } from "./daily-code";
import { generateN1 } from "./generator-n1";
import { DAILY_BOARD_SIZE, type Puzzle } from "./model";

/**
 * The seed of a date: HMAC-SHA256 of `nyoro-daily:<date>` under the
 * Worker's secret DAILY_SEED_SECRET, in hex. Without the secret, the seed of
 * a day that has not come yet cannot be known.
 */
export async function dailySeed(secret: string, date: string): Promise<string> {
  if (secret === "") throw new Error("The daily seed secret is empty.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`nyoro-daily:${date}`),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Seeds tried in turn: n1 gives up on a seed after a fixed number of
 * attempts, and every day needs a board. In 50 measured 10 × 10 hard seeds
 * (2026-11) none needed a second one.
 */
const DAILY_SEEDS = 8;

/**
 * d1, frozen (DESIGN.md 13.4): n1's construction at 10 × 10, hard by n1's
 * own rating (the trials of the logical solve). n1 is frozen too, so a seed
 * always makes the same board; tests/daily.test.ts holds the hashes. The
 * board carries the date as its seed and d1 as its version, so its puzzle ID
 * differs from any n1 board's.
 */
export function generateDailyPuzzle(seed: string, date: string): Puzzle {
  for (let index = 0; index < DAILY_SEEDS; index += 1) {
    try {
      const { puzzle } = generateN1(
        index === 0 ? seed : `${seed}:${index}`,
        DAILY_DIFFICULTY,
        DAILY_BOARD_SIZE,
      );
      return { ...puzzle, generatorVersion: DAILY_VERSION, seed: date };
    } catch (error) {
      // A seed without a board in n1's attempts; the next one is tried. A
      // board the complete solver rejects is a bug, not a seed to skip.
      if (!String(error).includes("could not generate")) throw error;
    }
  }
  throw new Error(`d1 could not make a board for ${date}`);
}
