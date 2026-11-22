/**
 * The player's name and consent to publish (DATA_CONTRACT.md 「プロフィールと
 * 公開」). The name is kan-game.app-wide, and so are its rules
 * (kan-game/name-rules), so a name taken in one game fits another.
 */
import { normalizeName } from "kan-game/name-rules";
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
      normalizeName(value.displayName) === value.displayName
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
