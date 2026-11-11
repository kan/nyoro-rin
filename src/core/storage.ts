/**
 * The small interface the core saves through (AGENTS.md 「永続化」). In the
 * browser it is localStorage; tests pass a Map-backed stand-in.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Reads a JSON value and checks it. A missing value gives undefined; a value
 * that does not parse or fails the check is copied to `<key>.corrupt` first
 * (DATA_CONTRACT.md: 破損値を上書きする前に退避する) and also gives undefined.
 * Storage that throws (blocked site data) gives undefined too.
 */
export function readJson<T>(
  storage: KeyValueStorage,
  key: string,
  parse: (value: unknown) => T | undefined,
): T | undefined {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  let parsed: T | undefined;
  try {
    parsed = parse(JSON.parse(raw));
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) backupCorruptValue(storage, key, raw);
  return parsed;
}

/** Whether the value was written. Play goes on without storage. */
export function writeJson(
  storage: KeyValueStorage,
  key: string,
  value: unknown,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function backupCorruptValue(
  storage: KeyValueStorage,
  key: string,
  raw: string,
): void {
  try {
    storage.setItem(`${key}.corrupt`, raw);
  } catch {
    // Best effort only; an unavailable store cannot hold a backup.
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
