import { ref, watch } from "vue";
import { apiFetch, apiPost, idWithdrawals, useId } from "./auth";
import { isAppleTouchDevice, isStandalone } from "./install";

/**
 * The daily notice on this device (DESIGN.md 25.8, src/worker/push.ts), as
 * TAKO-SEN's src/ui/push.ts. The subscription belongs to the device; the
 * server keeps it under the device's current ID.
 */
export type PushState =
  | "checking"
  /** The browser has no Web Push. */
  | "unsupported"
  /** iPhone or iPad: only an app added to the home screen gets push. */
  | "install"
  /** The server has no key (local development) or did not answer. */
  | "unavailable"
  /** The player or the device turned notifications off for the site. */
  | "denied"
  | "off"
  | "on";

export type PushProblem = "failed" | "offline" | "too_many";

export const pushState = ref<PushState>("checking");
export const pushBusy = ref(false);
export const pushProblem = ref<PushProblem>();

let knownKey: string | undefined;
/**
 * The server's VAPID public key, or "" where push is not set up. Only a key
 * is kept: an answer that failed is asked again next time.
 */
async function publicKey(): Promise<string> {
  if (knownKey) return knownKey;
  try {
    const response = await fetch("/api/push/key");
    if (!response.ok) return "";
    const { publicKey } = (await response.json()) as { publicKey?: unknown };
    if (typeof publicKey !== "string") return "";
    if (publicKey) knownKey = publicKey;
    return publicKey;
  } catch {
    return "";
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((byte, i) => byte === b[i]);
}

let knownRegistration: ServiceWorkerRegistration | undefined;
/**
 * The service worker the build registers (src/main.ts); none in `vite`.
 * Only one that was found is kept: on a first start it may still be on its
 * way, and is looked for again next time.
 */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (knownRegistration) return knownRegistration;
  if (!("serviceWorker" in navigator)) return undefined;
  knownRegistration =
    (await navigator.serviceWorker.getRegistration()) ??
    (await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
    ]));
  return knownRegistration;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

/** Looks at the browser and the server again (when the setting is shown). */
export async function refreshPushState(): Promise<void> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    pushState.value =
      isAppleTouchDevice() && !isStandalone() ? "install" : "unsupported";
    return;
  }
  const [found, key] = await Promise.all([registration(), publicKey()]);
  if (!key || !found) {
    pushState.value = "unavailable";
    return;
  }
  if (Notification.permission === "denied") {
    pushState.value = "denied";
    return;
  }
  const subscription = await found.pushManager.getSubscription();
  // One made for an earlier key pair (DEPLOY.md) receives nothing: off, so
  // switching it on makes a new one.
  pushState.value = subscription && madeFor(subscription, key) ? "on" : "off";
}

function madeFor(subscription: PushSubscription, key: string): boolean {
  return sameBytes(subscription.options.applicationServerKey, keyBytes(key));
}

const SUBSCRIPTION_PATH = "/api/push/subscription";

/**
 * The ID and endpoint the server last took, so a start sends the
 * subscription only when one of them changed.
 */
const SYNCED_KEY = "nyoro-rin.push-synced";

function syncedMark(subscription: PushSubscription): string {
  return `${useId().id.value ?? ""} ${subscription.endpoint}`;
}

function readSynced(): string | null {
  try {
    return localStorage.getItem(SYNCED_KEY);
  } catch {
    return null;
  }
}

function rememberSynced(mark: string | null): void {
  try {
    if (mark) localStorage.setItem(SYNCED_KEY, mark);
    else localStorage.removeItem(SYNCED_KEY);
  } catch {
    // Without storage every start sends it again, which is harmless.
  }
}

async function sendSubscription(subscription: PushSubscription) {
  const mark = syncedMark(subscription);
  const response = await apiPost(SUBSCRIPTION_PATH, subscription.toJSON());
  if (response.ok) rememberSynced(mark);
  return response;
}

export async function enablePush(): Promise<void> {
  if (pushBusy.value) return;
  pushBusy.value = true;
  pushProblem.value = undefined;
  let subscription: PushSubscription | null = null;
  let saved = false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      pushState.value = permission === "denied" ? "denied" : "off";
      return;
    }
    const [found, key] = await Promise.all([registration(), publicKey()]);
    if (!found || !key) {
      pushState.value = "unavailable";
      return;
    }
    subscription = await found.pushManager.getSubscription();
    // One made for an earlier key pair would never receive anything.
    if (subscription && !madeFor(subscription, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await found.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    const response = await sendSubscription(subscription);
    saved = response.ok;
    if (!saved)
      pushProblem.value = response.status === 409 ? "too_many" : "failed";
  } catch {
    pushProblem.value = navigator.onLine ? "failed" : "offline";
  } finally {
    // Not on the server, so nothing would arrive: undo it here as well, so
    // the setting does not show on.
    if (subscription) {
      if (!saved) await subscription.unsubscribe().catch(() => false);
      pushState.value = saved ? "on" : "off";
    }
    pushBusy.value = false;
  }
}

export async function disablePush(): Promise<void> {
  if (pushBusy.value) return;
  pushBusy.value = true;
  pushProblem.value = undefined;
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      // The device stops listening either way; a row left on the server is
      // deleted the first time its push service answers that it is gone.
      await apiFetch(SUBSCRIPTION_PATH, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
      // Before unsubscribing, which may fail: a subscription left on the
      // device is then sent again at the next start, as it shows as on.
      rememberSynced(null);
      await subscription.unsubscribe();
    }
    pushState.value = "off";
  } catch {
    pushProblem.value = "failed";
    await refreshPushState();
  } finally {
    pushBusy.value = false;
  }
}

/**
 * Keeps the server's copy with the device's current ID: once at start and
 * whenever the ID changes (a recovery code entered on kan-game.app),
 * a device that has notices on sends its subscription again. A withdrawal
 * is different: the notice went with the withdrawn ID, so the device stops
 * listening instead of carrying it over to the next ID.
 */
export function startPushSync(): void {
  const { id } = useId();
  /** The withdrawn ID's unsubscribing, which the next ID's sync waits for. */
  let withdrawing: Promise<void> = Promise.resolve();
  watch(idWithdrawals, () => {
    withdrawing = (async () => {
      try {
        await (await currentSubscription())?.unsubscribe();
      } catch {
        // The server row is gone already; nothing more to send.
      }
      rememberSynced(null);
      if (pushState.value === "on") pushState.value = "off";
    })();
  });
  watch(
    id,
    async (current) => {
      if (!current) return;
      try {
        await withdrawing;
        const subscription = await currentSubscription();
        if (!subscription || readSynced() === syncedMark(subscription)) return;
        // One made for an earlier key pair waits to be switched on again.
        const key = await publicKey();
        if (!key || !madeFor(subscription, key)) return;
        const response = await sendSubscription(subscription);
        // This ID has its most devices: undone, as enablePush does.
        if (response.status === 409) {
          await subscription.unsubscribe();
          pushProblem.value = "too_many";
          pushState.value = "off";
        }
      } catch {
        // Tried again with the next start or ID.
      }
    },
    { immediate: true },
  );
}
