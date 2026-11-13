/**
 * The online side of the screen (DESIGN.md chapter 20): the clears and play
 * logs sent for the device's kan-game.app ID, the player's name, the
 * rankings and the feedback. Everything here may fail without stopping
 * play: the board, the hints and the local records never wait on it.
 */
import { onScopeDispose, readonly, ref, shallowRef, watch } from "vue";
import {
  type AccountProfile,
  RANKING_CONSENT_VERSION,
  loadCachedProfile,
  saveCachedProfile,
} from "../core/account-profile";
import {
  type FeedbackContext,
  type SentFeedback,
  addSentFeedback,
  loadSentFeedback,
} from "../core/feedback";
import type { LeaderboardEntry } from "../core/leaderboard";
import type { Puzzle } from "../core/model";
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

/** The ranking of the board just cleared, as the clear card shows it. */
export type ClearRanking =
  | { readonly status: "sending" }
  | { readonly status: "ready"; readonly entries: readonly LeaderboardEntry[] }
  /** Not sent: no ID, no connection or no answer. It stays queued. */
  | { readonly status: "offline" };

export type ProfileResult =
  | { readonly ok: true; readonly profile: AccountProfile }
  | {
      readonly ok: false;
      readonly reason: "name_taken" | "invalid" | "offline" | "failed";
    };

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

  const profile = ref<AccountProfile | null>(null);
  const clearRanking = shallowRef<ClearRanking>();
  /** The puzzle whose ranking the clear card waits for. */
  let clearedPuzzleId: string | undefined;
  const sentFeedback = shallowRef<readonly SentFeedback[]>(
    loadSentFeedback(storage),
  );

  // --- sending ----------------------------------------------------------------

  /**
   * When each queue may send again after a 429: until the server's
   * Retry-After, the retry timer leaves it alone.
   */
  const resumeAt = { plays: 0, logs: 0 };

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

  async function sendPlay(play: CompletedPlayUpload): Promise<SendOutcome> {
    try {
      const response = await apiPost("/api/plays", play);
      const outcome = outcomeOf(response, "plays");
      if (outcome === "sent" && play.puzzleId === clearedPuzzleId) {
        const body = (await response.json()) as {
          entries?: LeaderboardEntry[];
        };
        clearRanking.value = body.entries
          ? { status: "ready", entries: body.entries }
          : await fetchClearRanking(play.puzzleId);
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
      plays.add(id.value, upload);
    } catch {
      clearRanking.value = { status: "offline" };
      return;
    }
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

  async function fetchClearRanking(puzzleId: string): Promise<ClearRanking> {
    const entries = await fetchLeaderboard(puzzleId);
    return entries ? { status: "ready", entries } : { status: "offline" };
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
      if (!account) return;
      // Records queued for another ID are not sent for this one.
      plays.keepOnly(account);
      logs.keepOnly(account);
    },
    { immediate: true },
  );

  watch(status, (now) => {
    const account = id.value;
    if (now !== "ready" || !account) return;
    void refreshProfile(account);
    void sync();
  });

  const timer = setInterval(() => void sync(), RETRY_MS);
  onScopeDispose(() => clearInterval(timer));

  return {
    id,
    name,
    status,
    profile: readonly(profile),
    clearRanking,
    sentFeedback,
    recordClear,
    recordPlayLog,
    forgetClear,
    fetchLeaderboard,
    registerProfile,
    sendFeedback,
  };
}

export type Online = ReturnType<typeof useOnline>;
