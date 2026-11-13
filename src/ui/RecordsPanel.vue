<script setup lang="ts">
/**
 * The local records (DESIGN.md 16.1, 16.2): per difficulty, the plays and
 * clears on this device and the latest plays.
 */
import { computed } from "vue";
import { DIFFICULTIES, type Difficulty } from "../core/model";
import { type ResultHistory, recentPlays, summarize } from "../core/results";
import { formatPlayDate, formatScore, formatSeconds } from "./format";
import { DIFFICULTY_LABELS } from "./labels";

/** How many of the latest plays are listed. */
const RECENT_LIMIT = 20;

const props = defineProps<{
  history: ResultHistory;
  /** The attempt on the board, listed as in play rather than unfinished. */
  currentPlayId?: string;
}>();

/** The difficulty shown; the parent may act on it too. */
const selected = defineModel<Difficulty>("difficulty", { default: "easy" });

const summary = computed(() => summarize(props.history, selected.value));

const recent = computed(() =>
  recentPlays(props.history, selected.value, RECENT_LIMIT),
);

function average(value: number | undefined, format: (n: number) => string) {
  return value === undefined ? "—" : format(value);
}
</script>

<template>
  <div class="records">
    <div class="tabs" role="tablist" aria-label="難易度">
      <button
        v-for="level in DIFFICULTIES"
        :key="level"
        type="button"
        role="tab"
        :aria-selected="level === selected"
        @click="selected = level"
      >
        {{ DIFFICULTY_LABELS[level] }}
      </button>
    </div>

    <dl class="stats">
      <div>
        <dt>プレイ</dt>
        <dd>{{ summary.plays }}</dd>
      </div>
      <div>
        <dt>クリア</dt>
        <dd>{{ summary.clears }}</dd>
      </div>
      <div>
        <dt>平均時間</dt>
        <dd>{{ average(summary.averageSeconds, formatSeconds) }}</dd>
      </div>
      <div>
        <dt>平均ヒント</dt>
        <dd>{{ average(summary.averageHints, (n) => n.toFixed(1)) }}</dd>
      </div>
      <div class="wide">
        <dt>最高スコア</dt>
        <dd v-if="summary.best">
          {{ formatScore(summary.best) }}
          <small>
            {{ formatSeconds(summary.best.elapsedSeconds) }} ・ ヒント
            {{ summary.best.hintsUsed }}
          </small>
        </dd>
        <dd v-else>—</dd>
      </div>
    </dl>

    <h3>最近のプレイ</h3>
    <p v-if="recent.length === 0" class="note">まだプレイしていません。</p>
    <ol v-else class="recent">
      <li v-for="play in recent" :key="play.playId">
        <span class="when">{{ formatPlayDate(play.startedAt) }}</span>
        <template v-if="play.status === 'completed'">
          <strong>{{ formatSeconds(play.elapsedSeconds) }}</strong>
          <span>{{ formatScore(play) }} 点</span>
          <span class="hints">ヒント {{ play.hintsUsed }}</span>
        </template>
        <span v-else class="unfinished">
          {{ play.playId === currentPlayId ? "プレイ中" : "未完了" }}
        </span>
      </li>
    </ol>
  </div>
</template>
