<script setup lang="ts">
/**
 * The player's daily challenges (DESIGN.md 25.6), from the server: the
 * days are not kept on the device. Choosing a day shows its ranking.
 */
import { onMounted, ref, shallowRef } from "vue";
import type { DailyHistoryEntry } from "../core/daily";
import DailyRankingPanel from "./DailyRankingPanel.vue";
import { formatScore, formatSeconds } from "./format";
import type { Online } from "./use-online";

const props = defineProps<{ online: Online }>();

/** Undefined while asked, null when it failed or there is no ID. */
const plays = shallowRef<readonly DailyHistoryEntry[] | null>();
const shownDate = ref<string>();

onMounted(async () => {
  plays.value = (await props.online.fetchDailyHistory()) ?? null;
});

function dateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}
</script>

<template>
  <div class="daily-records">
    <template v-if="shownDate">
      <button type="button" class="text-button" @click="shownDate = undefined">
        ‹ 挑戦の一覧に戻る
      </button>
      <DailyRankingPanel :online="online" :date="shownDate" />
    </template>
    <template v-else>
      <p v-if="plays === undefined" class="note">記録を取得しています…</p>
      <p v-else-if="plays === null" class="note">
        デイリーの記録は、kan-game.app の ID で通信できるときに表示します。
      </p>
      <p v-else-if="plays.length === 0" class="note">
        まだデイリーに挑戦していません。盤面の下のカレンダーのボタンから挑戦できます。
      </p>
      <ol v-else class="recent">
        <li v-for="play in plays" :key="play.playId">
          <button
            type="button"
            class="text-button"
            :aria-label="`${dateLabel(play.date)}のランキングを見る`"
            @click="shownDate = play.date"
          >
            {{ dateLabel(play.date) }}
          </button>
          <template v-if="play.completedAt !== null">
            <strong>{{ formatSeconds(play.elapsedSeconds ?? 0) }}</strong>
            <span>
              {{
                formatScore({
                  elapsedSeconds: play.elapsedSeconds ?? 0,
                  hintsUsed: play.hintsUsed ?? 0,
                })
              }}
              点
            </span>
            <span class="hints">ヒント {{ play.hintsUsed }}</span>
          </template>
          <span v-else class="unfinished">未完了</span>
        </li>
      </ol>
    </template>
  </div>
</template>
