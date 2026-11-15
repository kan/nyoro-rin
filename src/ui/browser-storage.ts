import { type KeyValueStorage } from "../core/storage";

/**
 * localStorage (or the tab's own sessionStorage), or nothing where site data
 * is blocked (reading it throws).
 */
export function browserStorage(
  kind: "localStorage" | "sessionStorage" = "localStorage",
): KeyValueStorage | undefined {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}
