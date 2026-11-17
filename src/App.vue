<script setup lang="ts">
/**
 * The play screen: the board takes the space, with only the difficulty and
 * the menu above it and the hint and moves below it. Everything else
 * is in the menu (src/ui/MenuDialog.vue).
 */
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { achievementDefinition } from "./core/achievements";
import { dailyDate, loadDailyGame } from "./core/daily";
import { playableDailyPuzzle } from "./ui/daily-board";
import { type DifficultyChoice } from "./core/difficulty-choice";
import { type FeedbackContext, type FeedbackSource } from "./core/feedback";
import { completedPlay } from "./core/results";
import { rememberTutorial, shouldShowTutorial } from "./core/tutorial";
import { type SeedCode } from "./core/seed-code";
import AchievementIcon from "./ui/AchievementIcon.vue";
import BoardView from "./ui/BoardView.vue";
import DifficultyDialog from "./ui/DifficultyDialog.vue";
import HintPanel from "./ui/HintPanel.vue";
import LeaderboardList from "./ui/LeaderboardList.vue";
import MenuDialog, { type MenuPage } from "./ui/MenuDialog.vue";
import UiIcon from "./ui/UiIcon.vue";
import { portalUrl } from "./ui/auth";
import { browserStorage } from "./ui/browser-storage";
import { dailyRequested } from "./ui/daily-request";
import { formatScore, formatSeconds } from "./ui/format";
import { DIFFICULTY_CHOICE_LABELS, DIFFICULTY_LABELS } from "./ui/labels";
import { useDifficultyChoice } from "./ui/use-difficulty-choice";
import { useBoardInput } from "./ui/use-board-input";
import { usePlay } from "./ui/use-play";
import { useHint } from "./ui/use-hint";
import { useOnline } from "./ui/use-online";
import { useSettings } from "./ui/use-settings";

const TutorialDialog = defineAsyncComponent({
  loader: () => import("./ui/TutorialDialog.vue"),
  // Unloaded: online, a page left over from an older deploy loads itself
  // again (src/main.ts, vite:preloadError); offline, or past the reload's
  // limit, the game goes on without it, READY included. Not marked seen, so
  // it comes again.
  onError: (_error, _retry, fail) => {
    fail();
    if (panel.value === "tutorial") closePanel();
  },
});

const settings = useSettings();
const online = useOnline();
const play = usePlay(settings, {
  onClear: showClear,
  onPlayLog: online.recordPlayLog,
  appVersion: __APP_VERSION__,
});
const hint = useHint(play);
const difficulty = useDifficultyChoice();
const { puzzle, board, geometry, annotations, inside, loop, solved, loading } =
  play;

/** The dialog open over the board, if any; one at a time. */
type Panel = "menu" | "difficulty" | "tutorial";
const panel = ref<Panel>();
/** Whether the tutorial opened by itself, on the device's first visit. */
const tutorialFirstVisit = ref(false);
const {
  zoom,
  tapPreview,
  mainBoardHandlers,
  zoomBoardHandlers,
  endGesture,
  closeZoom,
} = useBoardInput({
  geometry,
  states: computed(() => board.value.states),
  playable: play.playable,
  haptics: computed(() => settings.value.haptics),
  tap: play.tap,
  beginStroke: play.beginStroke,
  strokeEdges: play.strokeEdges,
  endStroke: play.endStroke,
  zoomable: true,
  onPress: () => endLap(),
  onZoom: play.noteZoom,
});
/** After a clear: the snake going round the loop, then the card. */
const clearPhase = ref<"lap" | "card">();
const confirmDialog = ref<HTMLDialogElement>();
const confirmOpen = ref(false);
const readyButton = ref<HTMLButtonElement>();
/** What to start once the player agrees to leave the current board. */
let pendingStart: (() => Promise<boolean>) | undefined;

const difficultyLabel = computed(() =>
  play.daily.value
    ? "デイリー"
    : puzzle.value
      ? DIFFICULTY_LABELS[puzzle.value.difficulty]
      : "",
);

/** READY covers the board, so the time off the clock is not time to think. */
const readyShown = computed(
  () => play.waiting.value && panel.value === undefined && !confirmOpen.value,
);

/**
 * The invitation to the ranking takes the place of the first READY of the
 * visit, once per device (DESIGN.md chapter 20). Whether it does is decided
 * once, when OK can first be pressed: a READY on screen is never swapped
 * for it, where a press meant for OK would land on the invitation. Shown or
 * not, it never comes up at a pause.
 */
const invite = ref<boolean>();
watch(
  [readyShown, loading],
  ([shown, making]) => {
    if (shown && !making && invite.value === undefined) {
      invite.value = online.inviteDue.value;
    }
  },
  { immediate: true },
);
watch(play.running, (running) => {
  if (running) invite.value = false;
});
const inviteShown = computed(
  () => readyShown.value && invite.value === true && online.inviteDue.value,
);
const inviteButton = ref<HTMLButtonElement>();
const inviteText = computed(() => {
  const shared = online.name.value;
  const lead = shared
    ? `kan-game.app のほかのゲームで決めたプレイヤー名「${shared}」で、NYORO-RIN のランキングにも参加できます。`
    : "プレイヤー名を決めると、問題ごとのランキングに成績が載ります。";
  return `${lead}名前を決めなくても遊べます。あとからメニューの「アカウント」でも設定できます。`;
});
const recoveryUrl = portalUrl("/account");

function joinRanking(): void {
  online.dismissInvite();
  openPanel("menu", "account");
}

// OK takes the focus once it can be pressed: READY also waits out the
// making of the next board, with OK disabled meanwhile.
watch([readyShown, loading, inviteShown], async ([shown, making, invite]) => {
  if (!shown) return;
  zoom.value = undefined;
  await nextTick();
  if (invite) inviteButton.value?.focus();
  else if (!making) readyButton.value?.focus();
});

/** The record of the board on screen, once it is cleared. */
const clearedPlay = computed(() =>
  completedPlay(play.history.value, play.attempt.value?.playId),
);

/**
 * What the clear card shows: the local record of an ordinary board, or the
 * day's result (the day's board is recorded by the server only).
 */
const clearStats = computed(() => {
  if (!play.daily.value) return clearedPlay.value;
  const attempt = play.attempt.value;
  return attempt && solved.value
    ? {
        elapsedSeconds: play.elapsedSeconds.value,
        hintsUsed: attempt.hintsUsed,
      }
    : undefined;
});

/**
 * The loop closed: the snake goes once round it, then the card comes
 * (DESIGN.md chapter 10).
 */
function showClear(): void {
  zoom.value = undefined;
  clearPhase.value = "lap";
  const session = play.daily.value;
  const attempt = play.attempt.value;
  if (session && attempt && puzzle.value) {
    void online.recordDailyClear({
      ...attempt,
      date: session.date,
      puzzleId: session.puzzleId,
      elapsedSeconds: play.elapsedSeconds.value,
      loop: [...puzzle.value.solution],
    });
    return;
  }
  const cleared = clearedPlay.value;
  if (cleared && puzzle.value) void online.recordClear(cleared, puzzle.value);
}

/** What the feedback screen sends with the text (DESIGN.md 20.2). */
const feedbackContext = computed<FeedbackContext>(() => {
  const attempt = play.attempt.value;
  const shown = puzzle.value;
  return {
    from: feedbackFrom.value,
    playId: attempt?.playId ?? null,
    seedCode: shown ? play.seedCode.value : null,
    difficulty: shown?.difficulty ?? null,
    cleared: solved.value,
    elapsedSeconds: play.elapsedSeconds.value,
    hintsUsed: attempt?.hintsUsed ?? 0,
    maxAssist: attempt?.maxAssist ?? null,
    appVersion: __APP_VERSION__,
  };
});

/** The lap ended, or a tap on the board cut it short. */
function endLap(): void {
  if (clearPhase.value === "lap") clearPhase.value = "card";
}

// --- the clock --------------------------------------------------------------

/**
 * Whether closing the menu or the confirmation runs the clock again: only
 * when it ran before they opened and the page stayed in front (as TAKO-SEN).
 */
let resumeOnClose = false;

function holdClock(): void {
  if (!play.running.value) return;
  resumeOnClose = true;
  play.pause();
}

function releaseClock(): void {
  const resume = resumeOnClose;
  resumeOnClose = false;
  if (resume && document.visibilityState === "visible" && document.hasFocus()) {
    play.start();
  }
}

/** Another tab or app came in front: back to READY (DESIGN.md 16.3). */
function suspend(): void {
  resumeOnClose = false;
  endGesture();
  play.pause();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") suspend();
}

/** The menu's page when it opens; the clear card opens it at a page. */
const menuPage = ref<MenuPage>("top");
/** Where the feedback screen was opened from, sent with the feedback. */
const feedbackFrom = ref<FeedbackSource>("menu");

/** A dialog over the board stops the clock while it is open. */
function openPanel(name: Panel, page: MenuPage = "top"): void {
  holdClock();
  menuPage.value = page;
  feedbackFrom.value =
    page === "feedback" && clearPhase.value === "card" ? "clear" : "menu";
  panel.value = name;
}

function closePanel(): void {
  panel.value = undefined;
  releaseClock();
}

function onKeydown(event: KeyboardEvent): void {
  // Esc in a dialog closes the dialog only; the view behind it stays.
  const dialogOpen = panel.value !== undefined || confirmDialog.value?.open;
  // READY is modal too: what it covers ignores the key.
  if (event.key !== "Escape" || dialogOpen || readyShown.value) return;
  if (clearPhase.value === "lap") endLap();
  else if (zoom.value) closeZoom();
  else if (hint.open.value) hint.close();
}

// --- moves and puzzles --------------------------------------------------

/**
 * Starts another board. Leaving a board the player has worked on asks
 * first: the lines and × on it would be lost.
 */
function requestStart(start: () => Promise<boolean>): void {
  // From the day's board, the ordinary board comes back first (the day's is
  // kept): leaving that one is what to ask about.
  if (play.daily.value) {
    clearPhase.value = undefined;
    online.forgetClear();
    play.leaveDaily();
  }
  holdClock();
  panel.value = undefined;
  if (play.marked.value && !solved.value) {
    pendingStart = start;
    confirmOpen.value = true;
    confirmDialog.value?.showModal();
    return;
  }
  void begin(start);
}

async function begin(start: () => Promise<boolean>): Promise<void> {
  resumeOnClose = false;
  zoom.value = undefined;
  clearPhase.value = undefined;
  online.forgetClear();
  await start();
}

function confirmStart(): void {
  const start = pendingStart;
  pendingStart = undefined;
  // Closing fires onConfirmClosed; the old board must not resume first.
  resumeOnClose = false;
  confirmDialog.value?.close();
  if (start) void begin(start);
}

/** The confirmation closed by 続ける, Esc or confirmStart. */
function onConfirmClosed(): void {
  confirmOpen.value = false;
  pendingStart = undefined;
  releaseClock();
}

/** A new puzzle at the device's choice, drawn anew each time for random. */
function next(): void {
  requestStart(() =>
    play.startNew(difficulty.next(), online.nextPuzzleCandidates()),
  );
}

/**
 * Starting at a difficulty also makes it the choice for later puzzles; a
 * start the player calls off at the confirmation changes nothing.
 */
function requestNew(choice: DifficultyChoice): void {
  requestStart(() => {
    difficulty.choose(choice);
    return play.startNew(difficulty.next(), online.nextPuzzleCandidates());
  });
}

function loadSeed(code: SeedCode): void {
  requestStart(() => play.load(code));
}

// --- the daily challenge (DESIGN.md chapter 25) -------------------------------

/** Why the day's board did not open, shown above the board for a while. */
const dailyNotice = ref<string>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function noticeDaily(text: string): void {
  dailyNotice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (dailyNotice.value = undefined), 8000);
}
/** The day whose ranking the menu shows. */
const dailyRankingDate = ref<string>();
const dailyOpening = ref(false);
/** Why READY's OK could not take the day's challenge. */
const dailyStartError = ref<string>();
const dailyStarting = ref(false);

const DAILY_START_ERRORS: Readonly<Record<string, string>> = {
  profile_required:
    "デイリーには、プレイヤー名とランキングへの参加が必要です。メニューの「アカウント」で設定してください。",
  already_started:
    "今日の挑戦は別の端末か画面で始まっています。始めた端末で続けてください。",
  completed: "今日のデイリーはクリア済みです。",
  expired:
    "日付が変わりました。通常の問題に戻り、今日のデイリーを開き直してください。",
  offline:
    "通信できませんでした。通信できる場所で、もう一度 OK を押してください。",
  failed: "今は始められません。少し待ってから、もう一度 OK を押してください。",
};

/** The day on the board, as 11月16日. */
const dailyLabel = computed(() => {
  const date = play.daily.value?.date;
  if (!date) return "";
  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日`;
});

/** The ranking of the day on the board, in the menu. */
function openDailyRanking(): void {
  dailyRankingDate.value = play.daily.value?.date;
  openPanel("menu", "daily");
}

/**
 * The calendar button: today's board. Without a name and consent, the
 * account page; done today, the day's ranking; started on another device, a
 * notice; otherwise READY (taken up again where this device left it).
 */
async function openDaily(): Promise<void> {
  if (play.daily.value) {
    backToOrdinary();
    return;
  }
  const account = online.id.value;
  if (!account || !online.profile.value) {
    noticeDaily("デイリーには、プレイヤー名とランキングへの参加が必要です。");
    openPanel("menu", "account");
    return;
  }
  if (dailyOpening.value) return;
  dailyOpening.value = true;
  try {
    const status = await online.fetchDaily();
    if (status === "unauthorized") {
      openPanel("menu", "account");
      return;
    }
    if (!status) {
      noticeDaily(
        "デイリーを読み込めませんでした。通信状態を確認してください。",
      );
      return;
    }
    const { board } = status;
    if (status.attempt === "completed") {
      dailyRankingDate.value = board.date;
      openPanel("menu", "daily");
      return;
    }
    const storage = browserStorage();
    const saved = storage && loadDailyGame(storage, account, board.date);
    if (
      status.attempt === "active" &&
      saved?.attempt.playId !== status.playId
    ) {
      noticeDaily(
        "今日の挑戦は別の端末で始まっています。始めた端末で続けてください。",
      );
      return;
    }
    const daily = await playableDailyPuzzle(board);
    if (!daily) {
      noticeDaily("デイリーの盤面を確かめられませんでした。");
      return;
    }
    // The ordinary board stays as it is: nothing to confirm.
    clearPhase.value = undefined;
    online.forgetClear();
    zoom.value = undefined;
    resumeOnClose = false;
    dailyStartError.value = undefined;
    panel.value = undefined;
    play.enterDaily(
      { account, date: board.date, puzzleId: board.puzzleId },
      daily,
      status.playId,
    );
    // A board finished on this device whose completion is still queued.
    if (play.solved.value) clearPhase.value = "card";
  } finally {
    dailyOpening.value = false;
  }
}

/**
 * A tap on the daily notice (DESIGN.md 25.8): the daily opens as the
 * calendar button would, once the server has told whether the ID has a name
 * and the board on screen is made, with no dialog open (the tutorial, the
 * menu, a confirmation). Already on today's board, there is nothing to do;
 * on an earlier day's, it goes back to the ordinary board first. Without a
 * connection or an answer about the name, it opens all the same, and
 * openDaily says why the daily cannot open. Not before onMounted, which
 * restores the board and opens the first visit's tutorial.
 */
const mounted = ref(false);
watch(
  () =>
    mounted.value &&
    dailyRequested.value &&
    (online.profileChecked.value ||
      online.status.value === "offline" ||
      online.status.value === "unavailable") &&
    !loading.value &&
    panel.value === undefined &&
    !confirmOpen.value &&
    !dailyOpening.value,
  (ready) => {
    if (!ready) return;
    dailyRequested.value = false;
    const shown = play.daily.value;
    if (shown?.date === dailyDate(Date.now())) return;
    if (shown) backToOrdinary();
    void openDaily();
  },
  { flush: "post" },
);

/** From the day's board back to the ordinary one, or a new one. */
function backToOrdinary(): void {
  clearPhase.value = undefined;
  online.forgetClear();
  zoom.value = undefined;
  dailyStartError.value = undefined;
  if (!play.leaveDaily()) {
    void play.startNew(difficulty.next(), online.nextPuzzleCandidates());
  }
}

/**
 * READY's OK. On the day's board, the first OK takes the day's challenge
 * from the server before the clock runs: once taken, it cannot be taken
 * again on another device or after a reload.
 */
async function onReadyOk(): Promise<void> {
  const session = play.daily.value;
  const attempt = play.attempt.value;
  if (session && attempt && !session.started) {
    if (dailyStarting.value) return;
    dailyStarting.value = true;
    dailyStartError.value = undefined;
    const result = await online.startDaily(session.date, attempt.playId);
    dailyStarting.value = false;
    if (play.daily.value !== session) return;
    if (result !== "started") {
      dailyStartError.value = DAILY_START_ERRORS[result];
      return;
    }
    play.markDailyStarted();
  }
  play.start();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("blur", suspend);
  window.addEventListener("pagehide", suspend);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const restored = play.restore();
  difficulty.startFrom(puzzle.value?.difficulty);
  if (!restored) void play.startNew(difficulty.next());
  // Before READY and the invitation to the ranking (DESIGN.md 11.5): both
  // wait while a panel is open.
  const storage = browserStorage();
  if (!storage || shouldShowTutorial(storage)) {
    tutorialFirstVisit.value = true;
    openPanel("tutorial");
  }
  mounted.value = true;
});

/** Closed in any way, the tutorial does not come by itself again. */
function closeTutorial(): void {
  const storage = browserStorage();
  if (storage) rememberTutorial(storage);
  tutorialFirstVisit.value = false;
  closePanel();
}
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("blur", suspend);
  window.removeEventListener("pagehide", suspend);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <div class="app-shell">
    <!-- READY is modal: what it covers takes no focus or clicks. -->
    <header class="top-bar" :inert="readyShown">
      <div class="status">
        <button
          v-if="difficultyLabel"
          type="button"
          class="chip chip-button"
          :aria-label="`難易度: ${difficultyLabel}。成績と、別の難易度で始める`"
          aria-haspopup="dialog"
          :aria-expanded="panel === 'difficulty'"
          @click="openPanel('difficulty')"
        >
          <UiIcon name="difficulty" />{{ difficultyLabel }}
        </button>
        <!-- Only the passing messages are announced, not the button. -->
        <span aria-live="polite">
          <span v-if="loading" class="status-text">問題を作っています…</span>
          <span v-else-if="play.failure.value" class="status-text error">
            {{ play.failure.value }}
          </span>
          <span v-else-if="dailyNotice" class="status-text error">
            {{ dailyNotice }}
          </span>
        </span>
      </div>
      <div class="top-actions">
        <span v-if="puzzle" class="chip timer" aria-label="経過時間">
          <UiIcon name="clock" />{{ formatSeconds(play.elapsedSeconds.value) }}
        </span>
        <button
          v-if="play.running.value"
          type="button"
          class="icon-button"
          aria-label="一時停止"
          title="一時停止"
          @click="play.pause"
        >
          <UiIcon name="pause" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="メニューを開く"
          title="メニュー"
          aria-haspopup="dialog"
          :aria-expanded="panel === 'menu'"
          @click="openPanel('menu')"
        >
          <UiIcon name="menu" />
        </button>
      </div>
    </header>

    <main class="board-area" :inert="readyShown">
      <div class="board-frame" :class="{ busy: loading }">
        <BoardView
          v-if="puzzle"
          :geometry="geometry"
          :clues="puzzle.clues"
          :states="board.states"
          :annotations="annotations"
          :inside="inside"
          :loop="loop"
          :lap="clearPhase === 'lap'"
          :label="`NYORO-RIN ${puzzle.size}×${puzzle.size} の盤面`"
          :hint="hint.marks.value"
          :tap-preview="tapPreview"
          v-bind="mainBoardHandlers"
          @lap-end="endLap"
        />

        <div
          v-if="zoom && puzzle"
          class="zoom-overlay"
          @pointerdown.self="closeZoom"
        >
          <div class="zoom-box" role="dialog" aria-label="拡大表示">
            <BoardView
              :geometry="geometry"
              :clues="puzzle.clues"
              :states="board.states"
              :annotations="annotations"
              :view="zoom"
              label="拡大した盤面"
              :hint="hint.marks.value"
              :tap-preview="tapPreview"
              v-bind="zoomBoardHandlers"
            />
            <button
              type="button"
              class="icon-button zoom-close"
              aria-label="拡大表示を閉じる"
              title="閉じる"
              @click="closeZoom"
            >
              <UiIcon name="close" />
            </button>
          </div>
        </div>

        <div v-if="clearPhase === 'card'" class="clear-overlay">
          <section
            class="clear-card"
            role="status"
            aria-labelledby="clear-title"
          >
            <img class="clear-icon" src="/nyoro.svg" alt="" />
            <h2 id="clear-title">輪が閉じました</h2>
            <p v-if="play.daily.value" class="note">
              {{ dailyLabel }}のデイリー
            </p>
            <dl v-if="clearStats" class="stats">
              <div>
                <dt>時間</dt>
                <dd>{{ formatSeconds(clearStats.elapsedSeconds) }}</dd>
              </div>
              <div>
                <dt>ヒント</dt>
                <dd>{{ clearStats.hintsUsed }}</dd>
              </div>
              <div>
                <dt>スコア</dt>
                <dd>{{ formatScore(clearStats) }}</dd>
              </div>
            </dl>
            <!-- Achievements this clear unlocked (DESIGN.md 20.4). -->
            <ul
              v-if="online.clearUnlocks.value.length > 0"
              class="clear-unlocks"
              aria-live="polite"
            >
              <li v-for="unlock in online.clearUnlocks.value" :key="unlock">
                <AchievementIcon :id="unlock" unlocked />
                実績解除: {{ achievementDefinition(unlock)?.name }}
              </li>
            </ul>
            <!-- The board's ranking from the answer to the upload. -->
            <div class="clear-ranking" aria-live="polite">
              <p
                v-if="online.clearRanking.value?.status === 'sending'"
                class="note"
              >
                記録を送っています…
              </p>
              <p
                v-else-if="online.clearRanking.value?.status === 'offline'"
                class="note"
              >
                記録はこの端末に保存しました。通信できるようになったら送ります。
              </p>
              <p
                v-else-if="online.clearRanking.value?.status === 'refused'"
                class="note"
              >
                {{
                  online.clearRanking.value.reason === "expired"
                    ? "この日のデイリーは締め切られたため、記録は残りません。デイリーは翌日の終わりまでに送れた分だけを記録します。"
                    : "クリアの時間が短すぎるため、記録は受け付けられませんでした。"
                }}
              </p>
              <template
                v-else-if="online.clearRanking.value?.status === 'ready'"
              >
                <LeaderboardList
                  :entries="online.clearRanking.value.entries"
                  :limit="3"
                />
                <button
                  v-if="play.daily.value"
                  type="button"
                  class="text-button"
                  @click="openDailyRanking"
                >
                  この日のランキングをすべて見る
                </button>
                <button
                  v-else-if="!online.profile.value"
                  type="button"
                  class="text-button"
                  @click="openPanel('menu', 'account')"
                >
                  名前を決めると、次の問題からランキングに載ります
                </button>
              </template>
            </div>
            <div v-if="play.daily.value" class="clear-actions">
              <button type="button" class="primary" @click="backToOrdinary">
                <UiIcon name="next" />通常の問題に戻る
              </button>
              <button type="button" @click="clearPhase = undefined">
                盤面を見る
              </button>
              <button type="button" @click="openPanel('menu', 'feedback')">
                感想を送る
              </button>
            </div>
            <div v-else class="clear-actions">
              <select
                :value="difficulty.choice.value"
                class="difficulty-select"
                aria-label="次の問題の難易度"
                @change="
                  difficulty.choose(
                    ($event.target as HTMLSelectElement)
                      .value as DifficultyChoice,
                  )
                "
              >
                <option
                  v-for="(label, value) in DIFFICULTY_CHOICE_LABELS"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
              </select>
              <button type="button" class="primary" @click="next">
                <UiIcon name="next" />次の問題
              </button>
              <button type="button" @click="clearPhase = undefined">
                盤面を見る
              </button>
              <button type="button" @click="openPanel('menu', 'feedback')">
                感想を送る
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>

    <!-- The hint sits between the board and the controls: it never covers
         the board, and undo stays at hand while reading it. -->
    <HintPanel
      v-if="hint.open.value"
      :inert="readyShown"
      :text="hint.text.value"
      :step="hint.step.value"
      :has-next="hint.hasNext.value"
      :next-label="hint.nextLabel.value"
      @next="hint.next"
      @close="hint.close"
    />
    <footer class="controls" :inert="readyShown">
      <div class="actions">
        <button
          type="button"
          class="icon-button hint-button"
          aria-label="ヒント"
          title="ヒント"
          :disabled="!play.playable.value"
          @click="hint.request"
        >
          <UiIcon name="hint" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="元に戻す"
          title="元に戻す"
          :disabled="!play.canUndo.value"
          @click="play.undo"
        >
          <UiIcon name="undo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="やり直す"
          title="やり直す"
          :disabled="!play.canRedo.value"
          @click="play.redo"
        >
          <UiIcon name="redo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="線と×をすべて消す"
          title="リセット"
          :disabled="!play.canReset.value"
          @click="play.reset"
        >
          <UiIcon name="reset" />
        </button>
        <button
          type="button"
          class="icon-button daily-button"
          :aria-label="play.daily.value ? '通常の問題に戻る' : '今日のデイリー'"
          :title="play.daily.value ? '通常の問題に戻る' : '今日のデイリー'"
          :aria-pressed="play.daily.value !== undefined"
          :disabled="dailyOpening"
          @click="openDaily"
        >
          <UiIcon name="calendar" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="次の問題へ"
          title="次の問題"
          :disabled="loading"
          @click="next"
        >
          <UiIcon name="next" />
        </button>
      </div>
    </footer>

    <div v-if="readyShown" class="ready-overlay" role="presentation">
      <section
        v-if="inviteShown"
        class="ready-card invite-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        aria-describedby="invite-text"
      >
        <img class="clear-icon" src="/nyoro.svg" alt="" />
        <h2 id="invite-title">ランキングに参加しませんか？</h2>
        <p id="invite-text" class="note">{{ inviteText }}</p>
        <div class="ready-actions">
          <button
            ref="inviteButton"
            type="button"
            class="primary"
            @click="joinRanking"
          >
            参加する
          </button>
          <button type="button" @click="online.dismissInvite">あとで</button>
        </div>
        <a
          class="note"
          :href="recoveryUrl"
          target="_blank"
          rel="noopener"
          @click="online.dismissInvite"
          >別の端末の ID を使う（復旧コード）</a
        >
      </section>
      <section
        v-else
        class="ready-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ready-title"
      >
        <h2 id="ready-title">READY?</h2>
        <template v-if="play.daily.value">
          <p class="note">{{ dailyLabel }}のデイリー（10×10・上級）</p>
          <p v-if="!play.daily.value.started" class="note">
            OK を押すと挑戦が始まります。挑戦は 1 日 1
            回で、別の端末や再読み込みではやり直せません。
          </p>
          <p v-if="dailyStartError" class="note error" role="alert">
            {{ dailyStartError }}
          </p>
        </template>
        <p v-if="loading" class="note">問題を作っています…</p>
        <p v-else-if="play.elapsedSeconds.value > 0" class="note">
          一時停止中（{{ formatSeconds(play.elapsedSeconds.value) }}）
        </p>
        <div class="ready-actions">
          <button
            ref="readyButton"
            type="button"
            class="primary"
            :disabled="loading || dailyStarting"
            @click="onReadyOk"
          >
            OK
          </button>
          <button type="button" @click="openPanel('menu')">
            <UiIcon name="menu" />メニュー
          </button>
          <button v-if="play.daily.value" type="button" @click="backToOrdinary">
            通常の問題に戻る
          </button>
        </div>
      </section>
    </div>

    <MenuDialog
      v-model:settings="settings"
      :open="panel === 'menu'"
      :seed-code="play.daily.value ? '' : play.seedCode.value"
      :daily-date="play.daily.value?.date"
      :daily-ranking-date="dailyRankingDate"
      :difficulty="puzzle?.difficulty"
      :choice="difficulty.choice.value"
      :history="play.history.value"
      :current-play-id="play.attempt.value?.playId"
      :puzzle="puzzle"
      :online="online"
      :feedback-context="feedbackContext"
      :initial-page="menuPage"
      @close="closePanel"
      @new-puzzle="requestNew"
      @load-seed="loadSeed"
      @tutorial="panel = 'tutorial'"
    />

    <!-- Loaded and built only when opened: most visits never open it. -->
    <TutorialDialog
      v-if="panel === 'tutorial'"
      :open="true"
      :first-visit="tutorialFirstVisit"
      :assist="settings.assist"
      :show-conflicts="settings.showConflicts"
      @close="closeTutorial"
      @complete="online.completeTutorial()"
    />

    <DifficultyDialog
      :open="panel === 'difficulty'"
      :difficulty="puzzle?.difficulty"
      :history="play.history.value"
      :current-play-id="play.attempt.value?.playId"
      @close="closePanel"
      @new-puzzle="requestNew"
    />

    <dialog
      ref="confirmDialog"
      class="confirm-dialog"
      aria-labelledby="confirm-title"
      @close="onConfirmClosed"
    >
      <div class="dialog-card">
        <h2 id="confirm-title">この問題をやめますか？</h2>
        <p>書き込んだ線と × は消えます。</p>
        <div class="dialog-actions">
          <button type="button" @click="confirmDialog?.close()">続ける</button>
          <button type="button" class="primary" @click="confirmStart">
            やめて始める
          </button>
        </div>
      </div>
    </dialog>
  </div>
</template>
