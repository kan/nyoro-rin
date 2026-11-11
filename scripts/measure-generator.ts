/**
 * Measures the generator (DESIGN.md 13.6 and chapter 17): time per board,
 * trials the solve needs, clue counts and discarded attempts.
 *
 *   npm run measure -- [boards per difficulty] [size]
 */
import { performance } from "node:perf_hooks";
import { generateN1 } from "../src/core/generator-n1";
import { DIFFICULTIES, isBoardSize } from "../src/core/model";

const count = Number(process.argv[2] ?? 30);
const size = Number(process.argv[3] ?? 7);
if (!isBoardSize(size)) throw new Error(`Unsupported size: ${size}`);

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
const histogram = (values: number[]) => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, n]) => `${value}:${n}`)
    .join(" ");
};

console.log(`n1 ${size}×${size}, ${count} boards per difficulty`);
for (const difficulty of DIFFICULTIES) {
  const times: number[] = [];
  const trials: number[] = [];
  const clues: number[] = [];
  const attempts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    const generated = generateN1(`measure-${i}`, difficulty, size);
    times.push(performance.now() - start);
    trials.push(generated.trials);
    clues.push(generated.puzzle.clues.filter((clue) => clue !== null).length);
    attempts.push(generated.attempt);
  }
  console.log(
    [
      `${difficulty}:`,
      `time median ${percentile(times, 0.5).toFixed(0)}ms`,
      `p90 ${percentile(times, 0.9).toFixed(0)}ms`,
      `max ${Math.max(...times).toFixed(0)}ms`,
      `| clues median ${percentile(clues, 0.5)}`,
      `| trials ${histogram(trials)}`,
      `| discarded ${histogram(attempts)}`,
    ].join(" "),
  );
}
