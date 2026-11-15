import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const SETTINGS_KEY = "nyoro-rin.settings.v1";

/** 0: none, 1: automatic ×, 2: automatic × and guide (DESIGN.md chapter 8). */
export type AssistLevel = 0 | 1 | 2;

/** DATA_CONTRACT.md 「ローカル保存と版」. */
export interface Settings {
  readonly assist: AssistLevel;
  readonly showConflicts: boolean;
  /** Sound effects start off, as in TAKO-SEN. */
  readonly sound: boolean;
  /** Vibration starts on, as in TAKO-SEN. */
  readonly haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  assist: 2,
  showConflicts: true,
  sound: false,
  haptics: true,
};

export function isAssistLevel(value: unknown): value is AssistLevel {
  return value === 0 || value === 1 || value === 2;
}

/**
 * Settings saved before the × tool was retired (issue #6) still carry
 * `tool`: it is left unread, so they load as they were.
 */
function parseSettings(value: unknown): Settings | undefined {
  if (!isRecord(value)) return undefined;
  const { assist, showConflicts, sound, haptics } = value;
  if (
    !isAssistLevel(assist) ||
    typeof showConflicts !== "boolean" ||
    typeof sound !== "boolean" ||
    typeof haptics !== "boolean"
  ) {
    return undefined;
  }
  return { assist, showConflicts, sound, haptics };
}

export function loadSettings(storage: KeyValueStorage): Settings {
  return readJson(storage, SETTINGS_KEY, parseSettings) ?? DEFAULT_SETTINGS;
}

export function saveSettings(
  storage: KeyValueStorage,
  settings: Settings,
): boolean {
  return writeJson(storage, SETTINGS_KEY, settings);
}
