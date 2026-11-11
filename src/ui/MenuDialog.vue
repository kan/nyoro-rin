<script setup lang="ts">
/**
 * The menu: everything that is not playing the board lives here, so the
 * play screen stays the board and a few buttons.
 */
import { nextTick, ref, watch } from "vue";
import { type Difficulty } from "../core/model";
import { type SeedCode, parseSeedCode } from "../core/seed-code";
import { type AssistLevel, type Settings } from "../core/settings";
import UiIcon from "./UiIcon.vue";
import { DIFFICULTY_LABELS } from "./labels";

type MenuPage = "top" | "new" | "seed" | "settings" | "help";

const PAGE_TITLES: Readonly<Record<MenuPage, string>> = {
  top: "メニュー",
  new: "新しい問題",
  seed: "シード",
  settings: "設定",
  help: "遊び方",
};

const props = defineProps<{
  open: boolean;
  seedCode: string;
  difficulty?: Difficulty;
}>();

const settings = defineModel<Settings>("settings", { required: true });

const emit = defineEmits<{
  close: [];
  newPuzzle: [difficulty: Difficulty];
  loadSeed: [code: SeedCode];
}>();

const dialog = ref<HTMLDialogElement>();
const page = ref<MenuPage>("top");
const seedInput = ref("");
const seedError = ref("");
const copied = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      dialog.value?.close();
      return;
    }
    page.value = "top";
    seedInput.value = "";
    seedError.value = "";
    copied.value = false;
    await nextTick();
    if (!dialog.value?.open) dialog.value?.showModal();
  },
);

const ASSIST_OPTIONS: readonly {
  value: AssistLevel;
  label: string;
  note: string;
}[] = [
  { value: 0, label: "なし", note: "補助なし" },
  { value: 1, label: "×を自動", note: "明らかな × を薄く表示する" },
  {
    value: 2,
    label: "×＋ガイド",
    note: "さらに、使える定石がある場所を光らせる",
  },
];

function update<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.value = { ...settings.value, [key]: value };
}

/** For the on/off settings: the checkbox's new state. */
function toggle(key: "showConflicts" | "haptics", event: Event): void {
  update(key, (event.target as HTMLInputElement).checked);
}

function submitSeed(): void {
  const code = parseSeedCode(seedInput.value);
  if (!code) {
    seedError.value = "シードコードの形が違います（例: NYORO:n1:easy:abc123）";
    return;
  }
  emit("loadSeed", code);
}

async function copySeed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.seedCode);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

/** Esc and the backdrop close the menu through the parent. */
function onCancel(event: Event): void {
  event.preventDefault();
  emit("close");
}

function onDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) emit("close");
}
</script>

<template>
  <dialog
    ref="dialog"
    class="menu-dialog"
    aria-labelledby="menu-title"
    @cancel="onCancel"
    @click="onDialogClick"
  >
    <div class="dialog-card">
      <header class="dialog-header">
        <button
          v-if="page !== 'top'"
          type="button"
          class="text-button"
          @click="page = 'top'"
        >
          ‹ 戻る
        </button>
        <h2 id="menu-title">{{ PAGE_TITLES[page] }}</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="メニューを閉じる"
          title="閉じる"
          @click="emit('close')"
        >
          <UiIcon name="close" />
        </button>
      </header>

      <nav v-if="page === 'top'" class="menu-list" aria-label="メニュー">
        <button type="button" @click="page = 'new'">
          <UiIcon name="next" />新しい問題
        </button>
        <button type="button" @click="page = 'seed'">
          <UiIcon name="seed" />シード
        </button>
        <button type="button" @click="page = 'settings'">
          <UiIcon name="settings" />設定
        </button>
        <button type="button" @click="page = 'help'">
          <UiIcon name="help" />遊び方
        </button>
      </nav>

      <section v-else-if="page === 'new'" class="menu-page">
        <p class="note">難易度を選ぶと、新しい問題を始めます。</p>
        <div class="choice-list">
          <button
            v-for="(label, value) in DIFFICULTY_LABELS"
            :key="value"
            type="button"
            :aria-current="value === difficulty ? 'true' : undefined"
            @click="emit('newPuzzle', value)"
          >
            {{ label }}
          </button>
        </div>
      </section>

      <section v-else-if="page === 'seed'" class="menu-page">
        <h3>この問題のシード</h3>
        <div class="seed-row">
          <code class="seed-code">{{ seedCode }}</code>
          <button
            type="button"
            class="icon-button"
            aria-label="シードをコピー"
            title="コピー"
            @click="copySeed"
          >
            <UiIcon name="copy" />
          </button>
        </div>
        <p class="note" role="status">{{ copied ? "コピーしました" : "" }}</p>
        <h3>シードから始める</h3>
        <form class="seed-form" @submit.prevent="submitSeed">
          <input
            v-model="seedInput"
            type="text"
            inputmode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="シードコード"
            placeholder="NYORO:n1:easy:..."
          />
          <button type="submit">始める</button>
        </form>
        <p v-if="seedError" class="error" role="alert">{{ seedError }}</p>
      </section>

      <section v-else-if="page === 'settings'" class="menu-page">
        <fieldset class="setting-group">
          <legend>アシスト</legend>
          <label
            v-for="option in ASSIST_OPTIONS"
            :key="option.value"
            class="radio"
          >
            <input
              type="radio"
              name="assist"
              :checked="settings.assist === option.value"
              @change="update('assist', option.value)"
            />
            <span>
              {{ option.label }}
              <small>{{ option.note }}</small>
            </span>
          </label>
        </fieldset>
        <label class="toggle">
          <input
            type="checkbox"
            :checked="settings.showConflicts"
            @change="toggle('showConflicts', $event)"
          />
          <span>
            矛盾を表示する
            <small>数字の超過・枝分かれ・行き止まり・小さな輪を赤く示す</small>
          </span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            :checked="settings.haptics"
            @change="toggle('haptics', $event)"
          />
          <span>
            振動
            <small>長押しで拡大したときに短く振動する（対応端末のみ）</small>
          </span>
        </label>
      </section>

      <section v-else class="menu-page help">
        <ul>
          <li>点と点を結んで、枝分かれも交差もしない 1 本の輪を作ります。</li>
          <li>数字は、そのマスの 4 辺のうち線が通る本数です。</li>
          <li>辺をタップすると、線 → × → 空 の順に変わります。</li>
          <li>点から点へなぞると、続けて線を引けます。</li>
          <li>
            盤面の下で「×」に切り替えると、タップやなぞりで × を付けられます。
          </li>
          <li>
            盤面を長押しすると、その周りを拡大します。拡大した盤面では、点からなぞると書き込み、点以外からドラッグすると表示する場所が動きます。
          </li>
        </ul>
      </section>
    </div>
  </dialog>
</template>
