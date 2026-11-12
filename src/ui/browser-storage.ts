import { type KeyValueStorage } from "../core/storage";

/** localStorage, or nothing where site data is blocked (reading it throws). */
export function browserStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
