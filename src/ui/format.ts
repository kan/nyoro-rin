import { type CompletedPlay, score } from "../core/results";

/** A clear time as `m:ss`, or `h:mm:ss` from an hour on. */
export function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** A clear's score (DESIGN.md 16.2) with digit grouping. */
export function formatScore(
  play: Pick<CompletedPlay, "elapsedSeconds" | "hintsUsed">,
): string {
  return score(play).toLocaleString("ja-JP");
}

/** A play's date: month, day and time, with the year only when not this year. */
export function formatPlayDate(epochMs: number, now = Date.now()): string {
  const date = new Date(epochMs);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString("ja-JP", {
    year: sameYear ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
