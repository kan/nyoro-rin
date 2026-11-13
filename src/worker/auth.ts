import { importVerificationKeys, verifyIdCookie, type IdKey } from "./id-token";

/**
 * The account of a request is the kan-game.app ID in its cookie
 * (kan/game docs/ID_DESIGN.md「ID と Cookie」). The cookie is verified here
 * with the ID platform's public keys; the platform is never asked.
 */
export type AuthEnv = Pick<
  Env,
  "DB" | "ID_COOKIE_NAME" | "ID_ISSUER" | "ID_PUBLIC_KEYS"
>;

export type Authentication =
  | { status: "ok"; accountId: string }
  | { status: "unauthorized" }
  | { status: "deleted" };

// Imported once per isolate; a changed setting reloads.
let cachedKeys: { json: string; keys: Promise<IdKey[]> } | undefined;

function verificationKeys(json: string): Promise<IdKey[]> {
  if (cachedKeys?.json !== json) {
    const keys = importVerificationKeys(json);
    // A failed import is retried by the next request rather than cached.
    keys.catch(() => {
      if (cachedKeys?.keys === keys) cachedKeys = undefined;
    });
    cachedKeys = { json, keys };
  }
  return cachedKeys.keys;
}

/**
 * The ID a request is signed with. An ID deleted through the ID platform keeps
 * its cookie for up to 400 days, so it is refused here rather than allowed to
 * write records again (DATA_CONTRACT.md 「退会」).
 */
export async function authenticateAccount(
  request: Request,
  env: AuthEnv,
): Promise<Authentication> {
  const claims = await verifyIdCookie(
    request.headers.get("Cookie"),
    env.ID_COOKIE_NAME,
    await verificationKeys(env.ID_PUBLIC_KEYS),
    env.ID_ISSUER,
    Date.now(),
  );
  if (!claims) return { status: "unauthorized" };
  const deleted = await env.DB.prepare(
    "SELECT 1 FROM deleted_accounts WHERE account_id = ?",
  )
    .bind(claims.sub)
    .first();
  return deleted
    ? { status: "deleted" }
    : { status: "ok", accountId: claims.sub };
}
