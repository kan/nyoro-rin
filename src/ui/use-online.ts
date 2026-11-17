/**
 * The online side of the screen (DESIGN.md chapter 20): the clears and play
 * logs sent for the device's kan-game.app ID, the player's name, the
 * rankings and the feedback. Everything here may fail without stopping
 * play: the board, the hints and the local records never wait on it.
 */
import {
  computed,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  type AccountProfile,
  RANKING_CONSENT_VERSION,
  hasCachedProfile,
  loadCachedProfile,
  loadInviteSeen,
  saveCachedProfile,
  saveInviteSeen,
} from "../core/account-profile";
import {
  type AchievementStatus,
  loadSeenAchievements,
  loadTutorialPending,
  markAchievementsSeen,
  parseAchievementList,
  parseNewAchievements,
  saveTutorialPending,
  tutorialPendingFor,
} from "../core/achievements";
import {
  type DailyCompletionUpload,
  type DailyHistoryEntry,
  type DailyRanking,
  type DailyStatus,
  parseDailyCompletionUpload,
  parseDailyHistory,
  parseDailyStatus,
} from "../core/daily";
import {
  type FeedbackContext,
  type SentFeedback,
  addSentFeedback,
  loadSentFeedback,
} from "../core/feedback";
import type { LeaderboardEntry } from "../core/leaderboard";
import type { WeeklyMetric, WeeklyRanking } from "../core/weekly-ranking";
import type { Difficulty, Puzzle } from "../core/model";
import {
  type CompletedPlayUpload,
  createCompletedPlayUpload,
  parseCompletedPlayUpload,
} from "../core/online-play";
import { Outbox, type SendOutcome } from "../core/outbox";
import { type PlayLogUpload, parsePlayLogUpload } from "../core/play-log";
import type { CompletedPlay } from "../core/results";
import { apiFetch, apiPost, setIdName, useId } from "./auth";
import { browserStorage } from "./browser-storage";

/** How often the queues are tried again while anything waits. */
const RETRY_MS = 30_000;
/**
 * How long the next puzzle waits for ranked candidates before the device
 * makes a board of its own: the player is waiting on READY meanwhile.
 */
const CANDIDATES_TIMEOUT_MS = 3000;

/** The ranking of the board just cleared, as the clear card shows it. */
export type ClearRanking =
  | { readonly status: "sending" }
  | { readonly status: "ready"; readonly entries: readonly LeaderboardEntry[] }
  /** Not sent: no ID, no connection or no answer. It stays queued. */
  | { readonly status: "offline" }
  /**
   * A daily completion refused for good: its day can no longer be completed
   * (expired), or the time is under the floor without hints (invalid_time).
   */
  | {
      readonly status: "refused";
      readonly reason: "expired" | "invalid_time";
    };

export type ProfileResult =
  | { readonly ok: true; readonly profile: AccountProfile }
  | {
      readonly ok: false;
      readonly reason: "name_taken" | "invalid" | "offline" | "failed";
    };

/** How READY's OK fared at taking the day's challenge (DESIGN.md 25.4). */
export type DailyStartResult =
  | "started"
  | "profile_required"
  | "already_started"
  | "completed"
  | "expired"
  | "offline"
  | "failed";

export type FeedbackResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "too_many" | "offline" | "failed" };

/** A storage that keeps nothing, for a device without localStorage. */
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

export function useOnline() {
  const storage = browserStorage() ?? NO_STORAGE;
  const { id, name, status } = useId();

  const plays = new Outbox<CompletedPlayUpload>(storage, {
    key: "nyoro-rin.sync-outbox.v1",
    parse: parseCompletedPlayUpload,
    idOf: (play) => play.playId,
    limit: 100,
  });
  const logs = new Outbox<PlayLogUpload>(storage, {
    key: "nyoro-rin.log-outbox.v1",
    parse: parsePlayLogUpload,
    idOf: (log) => log.playId,
    limit: 20,
  });
  /** Daily completions not yet answered (DESIGN.md 25.5). */
  const dailyCompletions = new Outbox<DailyCompletionUpload>(storage, {
    key: "nyoro-rin.daily-outbox.v1",
    parse: parseDailyCompletionUpload,
    idOf: (upload) => upload.playId,
    limit: 20,
  });

  const profile = ref<AccountProfile | null>(null);
  /** The ID whose profile the API answered for; until then none is known. */
  const profileCheckedFor = ref<string | null>(null);
  const inviteSeen = ref(loadInviteSeen(storage));
  const clearRanking = shallowRef<ClearRanking>();
  /** The clear whose ranking the clear card waits for. */
  let clearedPuzzleId: string | undefined;
  let clearedPlayId: string | undefined;
  /**
   * The achievements the clear on the card unlocked (DESIGN.md 20.4). Ones
   * unlocked by a clear sent later from the queue are not shown here; the
   * list marks them as new instead.
   */
  const clearUnlocks = shallowRef<readonly string[]>([]);
  const sentFeedback = shallowRef<readonly SentFeedback[]>(
    loadSentFeedback(storage),
  );

  // --- sending ----------------------------------------------------------------

  /**
   * When each queue may send again after a 429: until the server's
   * Retry-After, the retry timer leaves it alone.
   */
  const resumeAt = { plays: 0, logs: 0, daily: 0 };

  /** What an answer means for a queued item of the queue. */
  function outcomeOf(
    response: Response,
    queue: keyof typeof resumeAt,
  ): SendOutcome {
    if (response.ok) return "sent";
    // The server will never take it: a bad record or a conflicting resend.
    if (response.status === 400 || response.status === 409) return "rejected";
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After")) || 60;
      resumeAt[queue] = Date.now() + seconds * 1000;
    }
    return "retry";
  }

  /** The answer to an accepted clear or completion, as the card shows it. */
  interface ClearAnswer {
    readonly entries?: LeaderboardEntry[];
    readonly newAchievements?: unknown;
  }

  /**
   * The achievements the clear just made unlocked, for the card. Only the
   * clear on the card may announce them: a queued one from earlier may not.
   */
  function announceUnlocks(body: ClearAnswer): void {
    const unlocked = parseNewAchievements(body);
    clearUnlocks.value = unlocked;
    // Announced on the card: not new in the list any more.
    if (unlocked.length > 0 && id.value)
      markAchievementsSeen(storage, id.value, unlocked);
  }

  async function sendPlay(play: CompletedPlayUpload): Promise<SendOutcome> {
    try {
      const response = await apiPost("/api/plays", play);
      const outcome = outcomeOf(response, "plays");
      if (outcome === "sent" && play.puzzleId === clearedPuzzleId) {
        const body = (await response.json()) as ClearAnswer;
        if (play.playId === clearedPlayId) announceUnlocks(body);
        clearRanking.value = body.entries
          ? { status: "ready", entries: body.entries }
          : await fetchClearRanking(play.puzzleId);
      }
      return outcome;
    } catch {
      return "retry";
    }
  }

  async function sendDailyCompletion(
    upload: DailyCompletionUpload,
  ): Promise<SendOutcome> {
    try {
      const response = await apiPost("/api/daily/complete", upload);
      const outcome = outcomeOf(response, "daily");
      if (upload.playId !== clearedPlayId) return outcome;
      const body = (await response.json().catch(() => ({}))) as ClearAnswer & {
        readonly error?: unknown;
        readonly status?: unknown;
      };
      // The card moved on while the answer was read (another board).
      if (upload.playId !== clearedPlayId) return outcome;
      if (outcome === "sent") {
        announceUnlocks(body);
        clearRanking.value = body.entries
          ? { status: "ready", entries: body.entries }
          : { status: "offline" };
      } else if (outcome === "rejected") {
        // Dropped from the queue; the card says why, rather than that it
        // will be sent later.
        if (body.status === "expired") {
          clearRanking.value = { status: "refused", reason: "expired" };
        } else if (body.error === "invalid_time") {
          clearRanking.value = { status: "refused", reason: "invalid_time" };
        }
      }
      return outcome;
    } catch {
      return "retry";
    }
  }

  async function sendLog(log: PlayLogUpload): Promise<SendOutcome> {
    try {
      return outcomeOf(await apiPost("/api/play-logs", log), "logs");
    } catch {
      return "retry";
    }
  }

  /** The send running now; a sync asked meanwhile runs once after it. */
  let syncing: Promise<void> | undefined;
  let syncAgain = false;

  /** Sends what waits for the device's ID: clears first, then logs. */
  function sync(): Promise<void> {
    if (syncing) {
      syncAgain = true;
      return syncing;
    }
    syncing = drainAll().finally(() => {
      syncing = undefined;
      if (syncAgain) {
        syncAgain = false;
        void sync();
      }
    });
    return syncing;
  }

  async function drainAll(): Promise<void> {
    const account = id.value;
    if (account && status.value === "ready") {
      const current = () => id.value === account;
      const now = Date.now();
      if (now >= resumeAt.plays) await plays.drain(account, current, sendPlay);
      if (now >= resumeAt.daily)
        await dailyCompletions.drain(account, current, sendDailyCompletion);
      if (now >= resumeAt.logs) await logs.drain(account, current, sendLog);
    }
    // A clear that this round did not get a ranking for (offline, outage,
    // refused) is not shown as sending, unless another round is about to go.
    if (clearRanking.value?.status === "sending" && !syncAgain) {
      clearRanking.value = { status: "offline" };
    }
  }

  /**
   * The loop closed: the clear is queued for the device's ID and sent, and
   * the clear card shows the board's ranking from the answer. A device
   * without an ID keeps the clear only in its local records.
   */
  async function recordClear(
    play: CompletedPlay,
    puzzle: Pick<Puzzle, "generatorVersion" | "size" | "clues" | "solution">,
  ): Promise<void> {
    if (!id.value) {
      clearRanking.value = { status: "offline" };
      return;
    }
    clearRanking.value = { status: "sending" };
    try {
      const upload = await createCompletedPlayUpload(play, puzzle);
      clearedPuzzleId = upload.puzzleId;
      clearedPlayId = upload.playId;
      plays.add(id.value, upload);
    } catch {
      clearRanking.value = { status: "offline" };
      return;
    }
    await sync();
  }

  /**
   * The day's loop closed: the completion is queued for the ID and sent,
   * and the clear card shows the day's ranking from the answer. A queued one
   * goes again later, the next day included (DESIGN.md 25.5).
   */
  async function recordDailyClear(
    upload: DailyCompletionUpload,
  ): Promise<void> {
    if (!id.value) {
      clearRanking.value = { status: "offline" };
      return;
    }
    clearRanking.value = { status: "sending" };
    clearedPuzzleId = undefined;
    clearedPlayId = upload.playId;
    dailyCompletions.add(id.value, upload);
    await sync();
  }

  /** An attempt ended: its play log is queued and sent. */
  function recordPlayLog(log: PlayLogUpload): void {
    logs.add(id.value, log);
    void sync();
  }

  /** The board changed: the clear card's ranking no longer applies. */
  function forgetClear(): void {
    clearedPuzzleId = undefined;
    clearedPlayId = undefined;
    clearUnlocks.value = [];
    clearRanking.value = undefined;
  }

  // --- rankings ---------------------------------------------------------------

  async function fetchLeaderboard(
    puzzleId: string,
  ): Promise<readonly LeaderboardEntry[] | undefined> {
    try {
      const response = await apiFetch(
        `/api/leaderboards/${encodeURIComponent(puzzleId)}`,
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as { entries?: LeaderboardEntry[] };
      return body.entries;
    } catch {
      return undefined;
    }
  }

  /** This week's players (DESIGN.md 20.3); undefined when it failed. */
  async function fetchWeeklyRanking(
    difficulty: Difficulty,
    metric: WeeklyMetric,
  ): Promise<WeeklyRanking | undefined> {
    try {
      const query = new URLSearchParams({ difficulty, metric });
      const response = await apiFetch(`/api/weekly-ranking?${query}`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as Partial<WeeklyRanking>;
      return Array.isArray(body.entries) &&
        typeof body.start === "number" &&
        typeof body.end === "number"
        ? { start: body.start, end: body.end, entries: body.entries }
        : undefined;
    } catch {
      return undefined;
    }
  }

  async function fetchClearRanking(puzzleId: string): Promise<ClearRanking> {
    const entries = await fetchLeaderboard(puzzleId);
    return entries ? { status: "ready", entries } : { status: "offline" };
  }

  // --- the daily challenge -------------------------------------------------------

  /**
   * Today's board and how far the ID got with it; "unauthorized" without a
   * usable ID, undefined when it could not be read.
   */
  async function fetchDaily(): Promise<
    DailyStatus | "unauthorized" | undefined
  > {
    if (!id.value) return "unauthorized";
    try {
      const response = await apiFetch("/api/daily");
      if (response.status === 401 || response.status === 410) {
        return "unauthorized";
      }
      if (!response.ok) return undefined;
      return parseDailyStatus(await response.json());
    } catch {
      return undefined;
    }
  }

  /** READY's OK on the day's board: takes the day's one challenge. */
  async function startDaily(
    date: string,
    playId: string,
  ): Promise<DailyStartResult> {
    try {
      const response = await apiPost("/api/daily/start", { date, playId });
      if (response.ok) return "started";
      if (response.status === 403) return "profile_required";
      if (response.status === 409) {
        const body = (await response.json()) as { status?: unknown };
        if (
          body.status === "already_started" ||
          body.status === "completed" ||
          body.status === "expired"
        ) {
          return body.status;
        }
      }
      return "failed";
    } catch {
      return "offline";
    }
  }

  /** A day's ranking; undefined when it failed. */
  async function fetchDailyRanking(
    date: string,
  ): Promise<DailyRanking | undefined> {
    if (!id.value) return undefined;
    try {
      const response = await apiFetch(
        `/api/daily/ranking?date=${encodeURIComponent(date)}`,
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as Partial<DailyRanking>;
      return body.date === date && Array.isArray(body.entries)
        ? { date, entries: body.entries }
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** The ID's daily challenges, newest first; undefined when it failed. */
  async function fetchDailyHistory(): Promise<
    readonly DailyHistoryEntry[] | undefined
  > {
    if (!id.value) return undefined;
    try {
      const response = await apiFetch("/api/daily/history");
      if (!response.ok) return undefined;
      return parseDailyHistory(await response.json());
    } catch {
      return undefined;
    }
  }

  // --- the next puzzle --------------------------------------------------------

  /**
   * The source of ranked boards for the next puzzle (DESIGN.md 13.8), or
   * undefined without an ID: the device then makes the board itself.
   */
  function nextPuzzleCandidates():
    ((difficulty: Difficulty) => Promise<unknown>) | undefined {
    if (!id.value) return undefined;
    return async (difficulty) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        CANDIDATES_TIMEOUT_MS,
      );
      try {
        const response = await apiFetch(
          `/api/next-puzzle?difficulty=${encodeURIComponent(difficulty)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("No candidates.");
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    };
  }

  // --- achievements ------------------------------------------------------------

  /** The list of achievements (DESIGN.md 20.4); undefined when it failed. */
  async function fetchAchievements(): Promise<
    readonly AchievementStatus[] | undefined
  > {
    if (!id.value) return undefined;
    try {
      const response = await apiFetch("/api/achievements");
      if (!response.ok) return undefined;
      return parseAchievementList(await response.json()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  function seenAchievements(): Set<string> {
    return id.value ? loadSeenAchievements(storage, id.value) : new Set();
  }

  function markAchievementSeen(achievementId: string): Set<string> {
    return id.value
      ? markAchievementsSeen(storage, id.value, [achievementId])
      : new Set();
  }

  /** Sends the tutorial's achievement for the ID, if it waits for it. */
  async function sendTutorialAchievement(account: string): Promise<void> {
    try {
      const response = await apiPost("/api/achievements/unlock", {
        id: "tutorial_complete",
      });
      // Worth another try: no ID yet, too busy, or an outage.
      if (response.status === 401 || response.status === 429) return;
      if (response.status >= 500) return;
    } catch {
      return; // Offline: sent again when the ID is next confirmed.
    }
    if (loadTutorialPending(storage) === account)
      saveTutorialPending(storage, null);
  }

  /**
   * The tutorial was finished: kept for the device's ID (or for the next ID
   * known, without one) and sent when it can be.
   */
  function completeTutorial(): void {
    const account = id.value;
    saveTutorialPending(storage, account ?? "");
    if (account && status.value === "ready")
      void sendTutorialAchievement(account);
  }

  function sendPendingTutorial(account: string): void {
    const pending = loadTutorialPending(storage);
    const target = tutorialPendingFor(pending, account);
    if (!target) return;
    if (pending === "") saveTutorialPending(storage, target);
    void sendTutorialAchievement(target);
  }

  // --- the player's name --------------------------------------------------------

  async function refreshProfile(account: string): Promise<void> {
    try {
      const response = await apiFetch("/api/profile");
      if (!response.ok || id.value !== account) return;
      const body = (await response.json()) as {
        profile?: AccountProfile | null;
      };
      profile.value = body.profile ?? null;
      saveCachedProfile(account, profile.value, storage);
      profileCheckedFor.value = account;
    } catch {
      // The cached profile stands until the next answer.
    }
  }

  /** Sets the name (or takes the one from another game) and the consent. */
  async function registerProfile(displayName: string): Promise<ProfileResult> {
    const account = id.value;
    if (!account) return { ok: false, reason: "offline" };
    try {
      const response = await apiPost("/api/profile", {
        displayName,
        consentVersion: RANKING_CONSENT_VERSION,
      });
      if (response.status === 409) return { ok: false, reason: "name_taken" };
      if (response.status === 400) return { ok: false, reason: "invalid" };
      if (!response.ok) return { ok: false, reason: "failed" };
      const body = (await response.json()) as { profile: AccountProfile };
      if (id.value === account) {
        profile.value = body.profile;
        saveCachedProfile(account, body.profile, storage);
        setIdName(body.profile.displayName);
      }
      return { ok: true, profile: body.profile };
    } catch {
      return { ok: false, reason: "offline" };
    }
  }

  /** The API (or its cached answer) has told whether this ID has a name. */
  const profileChecked = computed(
    () => id.value !== null && profileCheckedFor.value === id.value,
  );

  /**
   * Whether to invite the player to choose a name: once per device, and only
   * when the API has said this ID has no name for NYORO-RIN yet (in this
   * visit or, through the cached answer, an earlier one). Before any answer
   * it waits, so a later visit can still show it.
   */
  const inviteDue = computed(
    () => !inviteSeen.value && profileChecked.value && profile.value === null,
  );

  function dismissInvite(): void {
    inviteSeen.value = true;
    saveInviteSeen(storage);
  }

  // --- feedback -----------------------------------------------------------------

  async function sendFeedback(
    body: string,
    context: FeedbackContext,
  ): Promise<FeedbackResult> {
    if (!id.value) return { ok: false, reason: "offline" };
    try {
      const response = await apiPost("/api/feedback", { body, context });
      if (response.status === 429) return { ok: false, reason: "too_many" };
      if (!response.ok) return { ok: false, reason: "failed" };
      sentFeedback.value = addSentFeedback(storage, {
        sentAt: Date.now(),
        body,
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: "offline" };
    }
  }

  // --- following the ID -----------------------------------------------------------

  watch(
    id,
    (account) => {
      profile.value = account ? loadCachedProfile(account, storage) : null;
      profileCheckedFor.value =
        account && hasCachedProfile(account, storage) ? account : null;
      if (!account) return;
      // Records queued for another ID are not sent for this one.
      plays.keepOnly(account);
      logs.keepOnly(account);
      dailyCompletions.keepOnly(account);
    },
    { immediate: true },
  );

  watch(status, (now) => {
    const account = id.value;
    if (now !== "ready" || !account) return;
    void refreshProfile(account);
    void sync();
    sendPendingTutorial(account);
  });

  const timer = setInterval(() => void sync(), RETRY_MS);
  onScopeDispose(() => clearInterval(timer));

  return {
    id,
    name,
    status,
    profile: readonly(profile),
    profileChecked,
    inviteDue,
    dismissInvite,
    clearRanking,
    clearUnlocks,
    sentFeedback,
    recordClear,
    recordDailyClear,
    recordPlayLog,
    forgetClear,
    fetchLeaderboard,
    fetchWeeklyRanking,
    fetchDaily,
    startDaily,
    fetchDailyRanking,
    fetchDailyHistory,
    fetchAchievements,
    seenAchievements,
    markAchievementSeen,
    completeTutorial,
    nextPuzzleCandidates,
    registerProfile,
    sendFeedback,
  };
}

export type Online = ReturnType<typeof useOnline>;
