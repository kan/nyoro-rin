import type { HintStage } from "./attempt";
import type { AssistLevel } from "./settings";

/**
 * One row of a puzzle's ranking (DATA_CONTRACT.md 「問題別ランキング」). The
 * public response leaves out account IDs, play IDs, dates and the solution.
 */
export interface LeaderboardEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly maxHintStage: HintStage;
  readonly maxAssist: AssistLevel;
  /** True only for the requester's own row, when it sent its ID cookie. */
  readonly isSelf: boolean;
}
