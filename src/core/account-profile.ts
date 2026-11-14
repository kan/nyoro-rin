/**
 * The player's name and consent to publish (DATA_CONTRACT.md 「プロフィールと
 * 公開」). The name is kan-game.app-wide; the rules are TAKO-SEN's (copied
 * from its src/core/account-profile.ts), so a name taken in one game fits
 * another.
 */
import { type KeyValueStorage, readJson, writeJson } from "./storage";

/** Whether the first-visit invitation to the ranking was shown (DESIGN.md 20). */
const INVITE_KEY = "nyoro-rin.ranking-invite.v1";

export function loadInviteSeen(storage: KeyValueStorage): boolean {
  return (
    readJson(storage, INVITE_KEY, (value) =>
      value === true ? true : undefined,
    ) ?? false
  );
}

export function saveInviteSeen(storage: KeyValueStorage): boolean {
  return writeJson(storage, INVITE_KEY, true);
}

/** The version of the consent text the screen shows. */
export const RANKING_CONSENT_VERSION = 1;

export interface AccountProfile {
  readonly displayName: string;
  readonly consentVersion: number;
}

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$/u;

export function gameNameParts(
  name: string,
): readonly { text: string; emoji: boolean }[] {
  return [...segmenter.segment(name)].map(({ segment }) => ({
    text: segment,
    emoji: emojiPattern.test(segment),
  }));
}

/** Cached consent only enables offline queueing, never server-side authorization. */
export function loadCachedProfile(
  accountId: string,
  storage: KeyValueStorage,
): AccountProfile | null {
  try {
    const raw = storage.getItem(`nyoro-rin.account-profile.v1:${accountId}`);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value &&
      value.consentVersion === RANKING_CONSENT_VERSION &&
      typeof value.displayName === "string" &&
      validateGameName(value.displayName) === value.displayName
      ? { displayName: value.displayName, consentVersion: value.consentVersion }
      : null;
  } catch {
    return null;
  }
}

/** Whether the API answered for this ID before: `null` saved means no name. */
export function hasCachedProfile(
  accountId: string,
  storage: KeyValueStorage,
): boolean {
  try {
    return (
      storage.getItem(`nyoro-rin.account-profile.v1:${accountId}`) !== null
    );
  } catch {
    return false;
  }
}

export function saveCachedProfile(
  accountId: string,
  profile: AccountProfile | null,
  storage: KeyValueStorage,
): void {
  try {
    storage.setItem(
      `nyoro-rin.account-profile.v1:${accountId}`,
      JSON.stringify(profile),
    );
  } catch {
    /* Offline play must not depend on storage availability. */
  }
}

/** A name's length in graphemes, as the player sees it. */
export const GAME_NAME_MIN = 2;
export const GAME_NAME_MAX = 20;

/**
 * Why a name is refused: its length in graphemes (or its size in UTF-16, which
 * only a very long name reaches), or a character outside the allowed set.
 */
export function gameNameProblem(value: string): "length" | "chars" | undefined {
  const name = value.normalize("NFC").trim();
  const parts = gameNameParts(name);
  if (
    name.length > 256 ||
    parts.length < GAME_NAME_MIN ||
    parts.length > GAME_NAME_MAX
  )
    return "length";
  return parts.every(
    (part) =>
      part.emoji ||
      (/^[\p{L}\p{N}\p{M} _-]+$/u.test(part.text) &&
        !/[\uFE0E\uFE0F]/u.test(part.text)),
  )
    ? undefined
    : "chars";
}

/** Names are plain text, never authentication identifiers or HTML. */
export function validateGameName(value: unknown): string | undefined {
  if (typeof value !== "string" || gameNameProblem(value)) return undefined;
  return value.normalize("NFC").trim();
}
