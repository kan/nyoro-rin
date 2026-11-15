/** Where a package runs: the screens, the service worker, the Worker. */
export type LicenseUse = "app" | "sw" | "server";

/** One package in licenses.json, which scripts/licenses-plugin.ts writes. */
export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string | null;
  text: string | null;
  usedIn: LicenseUse[];
}

let loading: Promise<LicenseEntry[]> | undefined;

/**
 * The licences list the build writes, read once and kept for every later
 * opening of the menu's about page. A failure is not kept, so the next opening
 * tries again. The dev server has no list and fails.
 */
export function loadLicenses(): Promise<LicenseEntry[]> {
  loading ??= (async () => {
    const response = await fetch("/licenses.json");
    if (!response.ok) throw new Error(String(response.status));
    const entries: unknown = await response.json();
    if (!Array.isArray(entries)) throw new Error("Not a licence list.");
    return entries as LicenseEntry[];
  })();
  loading.catch(() => (loading = undefined));
  return loading;
}
