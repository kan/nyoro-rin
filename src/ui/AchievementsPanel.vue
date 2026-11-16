<script setup lang="ts">
/**
 * The achievements (DESIGN.md 20.4): a tile for each, unlocked or as a
 * silhouette. The Worker judges them; this only shows the list. Unlocked
 * ones the device has not shown yet are marked NEW until opened.
 */
import { computed, ref, shallowRef } from "vue";
import {
  type AchievementStatus,
  isAchievementHidden,
} from "../core/achievements";
import AchievementIcon from "./AchievementIcon.vue";
import type { Online } from "./use-online";

const props = defineProps<{ online: Online }>();

/** Undefined while asked, null when it failed. */
const list = shallowRef<readonly AchievementStatus[] | null>();
const seen = shallowRef<ReadonlySet<string>>(new Set());
const selected = ref<string>();

async function load(): Promise<void> {
  list.value = undefined;
  if (!props.online.id.value) {
    list.value = null;
    return;
  }
  seen.value = props.online.seenAchievements();
  list.value = (await props.online.fetchAchievements()) ?? null;
}
void load();

const unlockedCount = computed(
  () => list.value?.filter((item) => item.unlockedAt !== null).length ?? 0,
);

const detail = computed(() =>
  list.value?.find((item) => item.definition.id === selected.value),
);

function isNew(item: AchievementStatus): boolean {
  return item.unlockedAt !== null && !seen.value.has(item.definition.id);
}

function hidden(item: AchievementStatus): boolean {
  return isAchievementHidden(item.definition, item.unlockedAt !== null);
}

function open(item: AchievementStatus): void {
  selected.value = item.definition.id;
  if (isNew(item))
    seen.value = props.online.markAchievementSeen(item.definition.id);
}

function label(item: AchievementStatus): string {
  const name = hidden(item) ? "ひみつの実績" : item.definition.name;
  return `${name}（${item.unlockedAt !== null ? "解除済み" : "未解除"}${isNew(item) ? "、新しく解除" : ""}）`;
}

function unlockedDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}
</script>

<template>
  <div class="achievements">
    <p v-if="!online.id.value" class="note">
      実績は、kan-game.app の ID を持つ端末で、オンラインのときに表示します。
    </p>
    <p v-else-if="list === undefined" class="note">実績を取得しています…</p>
    <p v-else-if="list === null" class="note">
      実績を取得できません。通信状態を確認して、開き直してください。
    </p>
    <template v-else>
      <p class="note">
        {{ unlockedCount }} / {{ list.length }}
        を解除しました。タイルを押すと条件を表示します。
      </p>
      <ul class="achievement-grid">
        <li v-for="item in list" :key="item.definition.id">
          <button
            type="button"
            class="achievement-tile"
            :aria-pressed="selected === item.definition.id"
            :aria-label="label(item)"
            @click="open(item)"
          >
            <AchievementIcon
              :id="item.definition.id"
              :unlocked="item.unlockedAt !== null"
            />
            <span class="achievement-name">
              {{ hidden(item) ? "？？？" : item.definition.name }}
            </span>
            <span v-if="isNew(item)" class="achievement-new">NEW</span>
          </button>
        </li>
      </ul>
      <section v-if="detail" class="achievement-detail" aria-live="polite">
        <h3>{{ hidden(detail) ? "ひみつの実績" : detail.definition.name }}</h3>
        <p>
          {{
            hidden(detail)
              ? "条件は解除するまでひみつです。"
              : detail.definition.description
          }}
        </p>
        <p class="note">
          <template v-if="detail.unlockedAt !== null">
            {{ unlockedDate(detail.unlockedAt) }} に解除
          </template>
          <template
            v-else-if="
              detail.progress !== null && detail.definition.metric !== 'client'
            "
          >
            {{ detail.progress }} / {{ detail.definition.threshold }}
          </template>
          <template v-else>未解除</template>
        </p>
      </section>
    </template>
  </div>
</template>
