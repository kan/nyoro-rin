<script setup lang="ts">
/**
 * A puzzle's ranking (DATA_CONTRACT.md 「問題別ランキング」): the score of
 * DESIGN.md 16.2, the time, the hints and the assist mark of each player's
 * first clear. `limit` shows the top rows and always the player's own.
 */
import { computed } from "vue";
import type { LeaderboardEntry } from "../core/leaderboard";
import { formatScore, formatSeconds } from "./format";
import { ASSIST_MARKS } from "./labels";

const props = defineProps<{
  entries: readonly LeaderboardEntry[];
  limit?: number;
}>();

const shown = computed(() => {
  const { entries, limit } = props;
  if (limit === undefined || entries.length <= limit) return entries;
  const top = entries.slice(0, limit);
  const self = entries.find((entry, i) => entry.isSelf && i >= limit);
  return self ? [...top, self] : top;
});
</script>

<template>
  <p v-if="entries.length === 0" class="note">まだ誰も載っていません。</p>
  <ol v-else class="leaderboard">
    <li
      v-for="entry in shown"
      :key="`${entry.rank}-${entry.displayName}`"
      :class="{ self: entry.isSelf }"
    >
      <span class="rank">{{ entry.rank }}</span>
      <span class="name">{{ entry.displayName }}</span>
      <span class="score">{{ formatScore(entry) }}</span>
      <span class="detail">
        {{ formatSeconds(entry.elapsedSeconds) }} ・ ヒント
        {{ entry.hintsUsed }}
        <small v-if="ASSIST_MARKS[entry.maxAssist]" class="assist-mark">
          {{ ASSIST_MARKS[entry.maxAssist] }}
        </small>
      </span>
    </li>
  </ol>
</template>
