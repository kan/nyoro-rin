/**
 * The daily notice (DESIGN.md 25.8, src/worker/push.ts), after TAKO-SEN's
 * tests/push-worker.test.ts.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { base64url, generateVapidKeys } from "../scripts/vapid-keys";
import { deleteAccount } from "../src/worker/accounts";
import worker, {
  DAILY_CRON,
  DAILY_RETRY_CRON,
  NOTICE_CRON,
  SWEEP_CRON,
} from "../src/worker/index";
import {
  MAX_SUBSCRIPTIONS_PER_ACCOUNT,
  isPushServiceEndpoint,
  noticeRequest,
  parseSubscription,
  saveSubscription,
  sendDailyNotifications,
} from "../src/worker/push";
import wranglerConfig from "../wrangler.jsonc?raw";
import { createFakeIdPlatform } from "kan-game/testing/fake-id-platform";
import {
  createTestIdIssuer,
  type TestIdIssuer,
} from "kan-game/testing/test-id-cookie";
import { DB, ORIGIN, call, post, workerEnv } from "./worker-env";

let issuer: TestIdIssuer;
let vapid: { publicKey: string; privateKey: string };

/** A subscription as a browser hands it out: an ECDH key and an auth secret. */
async function browserSubscription(n: number) {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: {
      p256dh: base64url(
        (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
      ),
      auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

function pushEnv(withKeys = true): Env {
  return workerEnv({
    ID: createFakeIdPlatform().rpc,
    ID_COOKIE_NAME: issuer.cookieName,
    ID_ISSUER: issuer.issuer,
    ID_PUBLIC_KEYS: issuer.publicKeys,
    VAPID_SUBJECT: "https://kan-game.app",
    ...(withKeys
      ? {
          VAPID_PUBLIC_KEY: vapid.publicKey,
          VAPID_PRIVATE_KEY: vapid.privateKey,
        }
      : {}),
  });
}

async function as(account: string) {
  return { Cookie: await issuer.cookie(account) };
}

function remove(body: unknown, headers: HeadersInit): RequestInit {
  return { ...post(body, headers), method: "DELETE" };
}

async function owners(): Promise<Record<string, string>> {
  const { results } = await DB.prepare(
    "SELECT endpoint, account_id FROM push_subscriptions ORDER BY endpoint",
  ).all<{ endpoint: string; account_id: string }>();
  return Object.fromEntries(results.map((r) => [r.endpoint, r.account_id]));
}

async function store(account: string, n: number): Promise<string> {
  const device = await browserSubscription(n);
  await saveSubscription(
    DB,
    account,
    { endpoint: device.endpoint, ...device.keys },
    n,
  );
  return device.endpoint;
}

beforeAll(async () => {
  issuer = await createTestIdIssuer();
  vapid = await generateVapidKeys();
});

beforeEach(async () => {
  await DB.prepare("DELETE FROM push_subscriptions").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("push subscriptions", () => {
  it("takes endpoints of the browsers' push services only", async () => {
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(
      true,
    );
    expect(isPushServiceEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceEndpoint("https://example.com/hook")).toBe(false);
    expect(isPushServiceEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    const good = await browserSubscription(1);
    expect(parseSubscription(good)).toEqual({
      endpoint: good.endpoint,
      ...good.keys,
    });
    expect(
      parseSubscription({ ...good, endpoint: "https://example.com/x" }),
    ).toBeUndefined();
    expect(
      parseSubscription({ ...good, keys: { p256dh: "a b", auth: "x" } }),
    ).toBeUndefined();
  });

  it("gives the screen the public key, or nothing without a key pair", async () => {
    const keyed = await call(pushEnv(), "/api/push/key");
    expect(await keyed.json()).toEqual({ publicKey: vapid.publicKey });
    const bare = await call(pushEnv(false), "/api/push/key");
    expect(await bare.json()).toEqual({ publicKey: "" });
    const wrong = await call(pushEnv(), "/api/push/key", post({}));
    expect(wrong.status).toBe(405);
  });

  it("stores a device under its ID, moves it with the ID, and deletes only its own", async () => {
    const env = pushEnv();
    const device = await browserSubscription(1);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const path = "/api/push/subscription";

    expect((await call(env, path, post(device))).status).toBe(401);
    expect((await call(env, path, post(device, await as(first)))).status).toBe(
      200,
    );
    expect(await owners()).toEqual({ [device.endpoint]: first });
    // The device took another ID over (a recovery code): it follows.
    await call(env, path, post(device, await as(second)));
    expect(await owners()).toEqual({ [device.endpoint]: second });
    // Another ID cannot remove it.
    const endpoint = { endpoint: device.endpoint };
    expect(
      (await call(env, path, remove(endpoint, await as(first)))).status,
    ).toBe(200);
    expect(await owners()).toEqual({ [device.endpoint]: second });
    await call(env, path, remove(endpoint, await as(second)));
    expect(await owners()).toEqual({});
  });

  it("refuses what is not a subscription, and a DELETE from another origin", async () => {
    const env = pushEnv();
    const device = await browserSubscription(1);
    const headers = await as(crypto.randomUUID());
    const path = "/api/push/subscription";
    const hook = { endpoint: "https://example.com/hook", keys: device.keys };
    expect((await call(env, path, post(hook, headers))).status).toBe(400);
    expect((await call(env, path, remove({}, headers))).status).toBe(400);
    const foreign = remove(
      { endpoint: device.endpoint },
      { ...headers, Origin: "https://evil.example" },
    );
    expect((await call(env, path, foreign)).status).toBe(403);
    expect(
      (await call(env, path, { headers: { ...headers, Origin: ORIGIN } }))
        .status,
    ).toBe(405);
  });

  it("refuses a device past the most an ID may have, and keeps the others", async () => {
    const account = crypto.randomUUID();
    const save = async (n: number) => {
      const device = await browserSubscription(n);
      return saveSubscription(
        DB,
        account,
        { endpoint: device.endpoint, ...device.keys },
        1000 + n,
      );
    };
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_ACCOUNT; i++)
      expect(await save(i)).toBe(true);
    expect(await save(MAX_SUBSCRIPTIONS_PER_ACCOUNT)).toBe(false);
    // A device already there may still send itself again.
    expect(await save(0)).toBe(true);
    expect(Object.keys(await owners())).toHaveLength(
      MAX_SUBSCRIPTIONS_PER_ACCOUNT,
    );
    const extra = await browserSubscription(99);
    const response = await call(
      pushEnv(),
      "/api/push/subscription",
      post(extra, await as(account)),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "too_many_devices" });
  });

  it("goes with a withdrawal, and only that ID's", async () => {
    const leaving = crypto.randomUUID();
    await store(leaving, 1);
    const staying = await store(crypto.randomUUID(), 2);
    await deleteAccount(DB, leaving);
    expect(Object.keys(await owners())).toEqual([staying]);
  });
});

describe("the daily notice", () => {
  it("is sent to every device and forgets those the push service no longer knows", async () => {
    const endpoints = [
      await store("id-0", 1),
      await store("id-1", 2),
      await store("id-2", 3),
    ];
    const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method?.toUpperCase()).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^vapid t=/);
      expect(headers["content-encoding"]).toBe("aes128gcm");
      // Not padded to 4 KB: Mozilla refuses that for some devices (413).
      expect((init?.body as Uint8Array).byteLength).toBeLessThan(400);
      return new Response(null, {
        status: String(url).endsWith("device-2") ? 410 : 201,
      });
    });
    const counts = await sendDailyNotifications(pushEnv(), send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(counts).toEqual({ sent: 2, gone: 1, failed: 0 });
    expect(Object.keys(await owners()).sort()).toEqual([
      endpoints[0],
      endpoints[2],
    ]);
  });

  it("keeps a device whose push service fails for now", async () => {
    await store("busy", 1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await sendDailyNotifications(pushEnv(), send)).toEqual({
      sent: 0,
      gone: 0,
      failed: 1,
    });
    expect(Object.keys(await owners())).toHaveLength(1);
  });

  it("is built unpadded, with one signature per push service", async () => {
    const keys = { subject: "https://kan-game.app", ...vapid };
    const signatures = new Map();
    const rows = await Promise.all(
      [1, 2].map(async (n) => {
        const device = await browserSubscription(n);
        return {
          endpoint: device.endpoint,
          key_p256dh: device.keys.p256dh,
          key_auth: device.keys.auth,
        };
      }),
    );
    const requests = await Promise.all(
      rows.map((row) => noticeRequest(row, keys, signatures)),
    );
    expect(signatures.size).toBe(1);
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect((request.body as Uint8Array).byteLength).toBeLessThan(400);
    }
    const [a, b] = requests.map(
      (r) => (r.headers as Record<string, string>).authorization,
    );
    expect(a).toBe(b);
  });

  it("sends nothing without a key pair", async () => {
    await store("quiet", 1);
    const send = vi.fn();
    expect(await sendDailyNotifications(pushEnv(false), send)).toEqual({
      sent: 0,
      gone: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("is what the 0:05 cron runs", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const endpoint = await store("cron", 1);
    await worker.scheduled(
      { cron: NOTICE_CRON, scheduledTime: Date.now() } as ScheduledController,
      pushEnv(),
    );
    expect(send).toHaveBeenCalledWith(endpoint, expect.anything());
  });

  it("runs at a cron of every environment in wrangler.jsonc", () => {
    const crons = [...wranglerConfig.matchAll(/"crons": \[([^\]]*)\]/g)].map(
      (m) => JSON.parse(`[${m[1]}]`) as string[],
    );
    // The top level, dev and production.
    expect(crons).toHaveLength(3);
    for (const environment of crons)
      expect(environment).toEqual([
        SWEEP_CRON,
        DAILY_CRON,
        DAILY_RETRY_CRON,
        NOTICE_CRON,
      ]);
  });
});
