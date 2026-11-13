import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  importVerificationKeys,
  verifyIdCookie,
  verifyIdToken,
  type IdTokenClaims,
} from "../src/worker/id-token";

/*
 * The copy of kan/game's src/token.ts (src/worker/id-token.ts) against kan/game's
 * test-vectors/id-token.json (tests/id-token-vectors.json), with the same
 * checks as kan/game's test/vectors.test.ts. Recopy both files together.
 */
interface Vectors {
  issuer: string;
  now: number;
  cookieName: string;
  keys: unknown[];
  tokens: { name: string; token: string; expected: IdTokenClaims | null }[];
  cookies: { name: string; header: string | null; expected: string | null }[];
}
const vectors: Vectors = JSON.parse(
  readFileSync(new URL("./id-token-vectors.json", import.meta.url), "utf8"),
);
const keys = await importVerificationKeys(JSON.stringify(vectors.keys));

describe("test vectors: tokens", () => {
  it.each(vectors.tokens)("$name", async ({ token, expected }) => {
    const claims: IdTokenClaims | null = await verifyIdToken(
      token,
      keys,
      vectors.issuer,
      vectors.now,
    );
    expect(claims).toEqual(expected);
  });
});

describe("test vectors: cookie headers", () => {
  it.each(vectors.cookies)("$name", async ({ header, expected }) => {
    const claims = await verifyIdCookie(
      header,
      vectors.cookieName,
      keys,
      vectors.issuer,
      vectors.now,
    );
    expect(claims?.sub ?? null).toBe(expected);
  });
});

it("the valid token stays valid for its whole lifetime from now", () => {
  const valid = vectors.tokens.find((vector) => vector.name === "valid");
  expect(valid?.expected?.exp).toBeGreaterThan(vectors.now / 1000);
});
