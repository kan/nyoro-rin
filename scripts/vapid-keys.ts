/**
 * A VAPID key pair for Web Push (src/worker/push.ts), as TAKO-SEN's
 * scripts/vapid-keys.ts: the public key raw in base64url, the private key as
 * its JWK `d`, the forms the push library and the browsers take.
 * scripts/generate-vapid-keys.ts prints one; the tests make their own, in
 * the Workers runtime too (no Buffer there).
 */
export async function generateVapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = base64url(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const { d } = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  if (!d) throw new Error("no private key");
  return { publicKey, privateKey: d };
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
