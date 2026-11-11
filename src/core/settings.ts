import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export const SETTINGS_KEY = "nyoro-rin.settings.v1";

/** 0: none, 1: automatic ×, 2: automatic × and guide (DESIGN.md chapter 8). */
export type AssistLevel = 0 | 1 | 2;

/** What a tap or a stroke writes (DESIGN.md 7.1). */
export type Tool = "line" | "cross";

/** DATA_CONTRACT.md 「ローカル保存と版」. */
export interface Settings {
  readonly assist: AssistLevel;
  readonly showConflicts: boolean;
  readonly tool: Tool;
  /** Sound effects start off, as in TAKO-SEN. */
  readonly sound: boolean;
  /** Vibration starts on, as in TAKO-SEN. */
  readonly haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  assist: 2,
  showConflicts: true,
  tool: "line",
  sound: false,
  haptics: true,
};

export function isAssistLevel(value: unknown): value is AssistLevel {
  return value === 0 || value === 1 || value === 2;
}

export function isTool(value: unknown): value is Tool {
  return value === "line" || value === "cross";
}

function parseSettings(value: unknown): Settings | undefined {
  if (!isRecord(value)) return undefined;
  const { assist, showConflicts, tool, sound, haptics } = value;
  if (
    !isAssistLevel(assist) ||
    typeof showConflicts !== "boolean" ||
    !isTool(tool) ||
    typeof sound !== "boolean" ||
    typeof haptics !== "boolean"
  ) {
    return undefined;
  }
  return { assist, showConflicts, tool, sound, haptics };
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
