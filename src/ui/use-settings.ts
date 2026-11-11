import { type Ref, ref, watch } from "vue";
import {
  DEFAULT_SETTINGS,
  type Settings,
  loadSettings,
  saveSettings,
} from "../core/settings";
import { type KeyValueStorage } from "../core/storage";

/** localStorage, or nothing where site data is blocked (reading it throws). */
export function browserStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The device's settings, saved whenever they change. */
export function useSettings(): Ref<Settings> {
  const storage = browserStorage();
  const settings = ref<Settings>(
    storage ? loadSettings(storage) : DEFAULT_SETTINGS,
  );
  watch(settings, (value) => {
    if (storage) saveSettings(storage, value);
  });
  return settings;
}
