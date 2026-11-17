/**
 * The daily notice by Web Push (DESIGN.md 25.8, kan/nyoro-rin#8), as
 * TAKO-SEN's src/worker/push.ts. A device subscribes with its ID; the cron
 * at 0:05 in Japan tells every subscribed device that the day's daily has
 * opened. Subscriptions the push service has forgotten (404/410) are deleted
 * as they are found.
 */
import {
  encryptNotification,
  vapidHeaders,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";

export interface PushEnv {
  readonly DB: D1Database;
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

export interface Subscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Devices per ID. One more is refused rather than an older one dropped: the
 * dropped device would go on showing the notice as on and get nothing.
 */
export const MAX_SUBSCRIPTIONS_PER_ACCOUNT = 20;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;
const BATCH_SIZE = 100;

/**
 * The push services browsers hand endpoints out for (Chrome, Firefox, Safari,
 * Edge). The cron POSTs to every stored endpoint, so nothing else is taken.
 */
const PUSH_SERVICE_HOST =
  /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(.+\.)?push\.apple\.com|.+\.notify\.windows\.com)$/;

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_SERVICE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** The body of POST /api/push/subscription, or undefined if it is not one. */
export function parseSubscription(body: unknown): Subscription | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: unknown };
  if (
    typeof endpoint !== "string" ||
    endpoint.length > MAX_ENDPOINT_LENGTH ||
    !isPushServiceEndpoint(endpoint) ||
    typeof keys !== "object" ||
    keys === null
  )
    return undefined;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  const key = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_KEY_LENGTH &&
    /^[A-Za-z0-9_-]+=*$/.test(value);
  return key(p256dh) && key(auth) ? { endpoint, p256dh, auth } : undefined;
}

/**
 * Stores the device's subscription under this ID. An endpoint belongs to one
 * device, which may have switched IDs (a transfer code, a QR code), so it
 * moves to the ID that sends it; only the device holds its keys. Returns
 * false when the ID already has its most devices.
 */
export async function saveSubscription(
  db: D1Database,
  accountId: string,
  subscription: Subscription,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, account_id, key_p256dh, key_auth, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT COUNT(*) FROM push_subscriptions
              WHERE account_id = ?2 AND endpoint <> ?1) < ?6
       ON CONFLICT (endpoint) DO UPDATE SET account_id = excluded.account_id,
         key_p256dh = excluded.key_p256dh, key_auth = excluded.key_auth,
         created_at = excluded.created_at`,
    )
    .bind(
      subscription.endpoint,
      accountId,
      subscription.p256dh,
      subscription.auth,
      now,
      MAX_SUBSCRIPTIONS_PER_ACCOUNT,
    )
    .run();
  return result.meta.changes > 0;
}

/** Only the ID's own subscription goes. */
export async function deleteSubscription(
  db: D1Database,
  accountId: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM push_subscriptions WHERE account_id = ? AND endpoint = ?",
    )
    .bind(accountId, endpoint)
    .run();
}

export function vapidKeys(env: PushEnv): VapidKeys | undefined {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      }
    : undefined;
}

/**
 * What public/push-sw.js shows (its fallbacks are only for a message that
 * cannot be read: the wording lives here).
 */
const DAILY_NOTICE = {
  title: "NYORO-RIN",
  body: "今日のデイリーが始まりました。",
  // Opens the daily as its button does (src/ui/daily-request.ts).
  url: "/?daily=1",
};

type Outcome = "sent" | "gone" | "failed";
type Row = { endpoint: string; key_p256dh: string; key_auth: string };
/** VAPID signatures by push service origin, for one run. */
type Signatures = Map<string, Promise<{ authorization: string }>>;

const NOTICE_BYTES = new TextEncoder().encode(JSON.stringify(DAILY_NOTICE));

/**
 * The request that delivers the notice to one subscription. The library's
 * buildPushPayload pads every message to 4 KB, which Mozilla's push service
 * refuses for some devices (413 "intended for a constrained device"), so the
 * message is encrypted here without padding: the notice is a fixed text, so
 * its length tells nothing. The VAPID signature depends only on the push
 * service, so one per service serves the whole run (`signatures`).
 */
export async function noticeRequest(
  row: Row,
  keys: VapidKeys,
  signatures: Signatures = new Map(),
): Promise<RequestInit> {
  const subscription: PushSubscription = {
    endpoint: row.endpoint,
    expirationTime: null,
    keys: { p256dh: row.key_p256dh, auth: row.key_auth },
  };
  const service = new URL(row.endpoint).origin;
  let signature = signatures.get(service);
  if (!signature) {
    signature = vapidHeaders(subscription, keys).then((v) => v.headers);
    signatures.set(service, signature);
    // A failed one is made again for the next row rather than kept.
    signature.catch(() => signatures.delete(service));
  }
  const [{ authorization }, body] = await Promise.all([
    signature,
    encryptNotification(subscription, NOTICE_BYTES, { pad: false }),
  ]);
  return {
    method: "POST",
    headers: {
      authorization,
      // An hour: a notice that the day has started is still worth showing
      // to a phone that was off at midnight.
      ttl: String(60 * 60),
      urgency: "normal",
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
    },
    body,
  };
}

async function notify(
  row: Row,
  keys: VapidKeys,
  send: typeof fetch,
  signatures: Signatures,
): Promise<Outcome> {
  try {
    const request = await noticeRequest(row, keys, signatures);
    const { status } = await send(row.endpoint, request);
    if (status === 404 || status === 410) return "gone";
    if (status >= 200 && status < 300) return "sent";
    console.error(JSON.stringify({ event: "daily_push_refused", status }));
  } catch (error) {
    console.error(
      JSON.stringify({ event: "daily_push_failure", error: String(error) }),
    );
  }
  return "failed";
}

/**
 * Sends the notice to every subscription, a batch at a time, and deletes the
 * ones the push service no longer knows. `send` is fetch, replaced in tests.
 *
 * One run makes a request per subscription, which Workers caps per
 * invocation (1000 on Workers Paid): beyond about a thousand subscriptions
 * the sending has to be split, e.g. through a queue (docs/DEPLOY.md).
 */
export async function sendDailyNotifications(
  env: PushEnv,
  send: typeof fetch = fetch,
): Promise<Record<Outcome, number>> {
  const keys = vapidKeys(env);
  const counts: Record<Outcome, number> = { sent: 0, gone: 0, failed: 0 };
  const signatures: Signatures = new Map();
  if (!keys) return counts;
  let after = "";
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT endpoint, key_p256dh, key_auth FROM push_subscriptions
       WHERE endpoint > ? ORDER BY endpoint LIMIT ?`,
    )
      .bind(after, BATCH_SIZE)
      .all<Row>();
    if (results.length === 0) break;
    after = results[results.length - 1].endpoint;
    const outcomes = await Promise.all(
      results.map((row) => notify(row, keys, send, signatures)),
    );
    const gone = results
      .filter((_, i) => outcomes[i] === "gone")
      .map((row) => row.endpoint);
    for (const outcome of outcomes) counts[outcome]++;
    if (gone.length > 0)
      await env.DB.batch(
        gone.map((endpoint) =>
          env.DB.prepare(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
          ).bind(endpoint),
        ),
      );
    if (results.length < BATCH_SIZE) break;
  }
  return counts;
}
