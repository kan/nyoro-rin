import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DB } from "./worker-env";

describe("GameService", () => {
  it("runs in the Workers runtime", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
  });

  it("deletes an ID's records through the real entrypoint", async () => {
    const id = crypto.randomUUID();
    await DB.prepare(
      "INSERT INTO profiles (account_id, display_name) VALUES (?, ?)",
    )
      .bind(id, `leaving-${id.slice(0, 8)}`)
      .run();

    // What the ID platform calls through its GAME_NYORO binding.
    await exports.GameService.deleteAccount(id);

    expect(
      await DB.prepare("SELECT 1 FROM profiles WHERE account_id = ?")
        .bind(id)
        .first(),
    ).toBeNull();
    expect(
      await DB.prepare("SELECT 1 FROM deleted_accounts WHERE account_id = ?")
        .bind(id)
        .first(),
    ).not.toBeNull();
  });

  it("refuses a call without an ID", async () => {
    const failure = await exports.GameService.deleteAccount("").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("invalid id");
  });
});
