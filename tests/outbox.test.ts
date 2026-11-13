import { describe, expect, it } from "vitest";
import { Outbox, type SendOutcome } from "../src/core/outbox";
import { memoryStorage } from "./helpers";

const KEY = "test.outbox.v1";

function outbox(storage = memoryStorage().storage, limit = 10) {
  return new Outbox<{ id: string }>(storage, {
    key: KEY,
    parse: (value) =>
      typeof (value as { id?: unknown })?.id === "string"
        ? (value as { id: string })
        : undefined,
    idOf: (item) => item.id,
    limit,
  });
}

describe("the outbox (DATA_CONTRACT.md 「履歴の同期」)", () => {
  it("queues nothing without an ID, and an item once per ID", () => {
    const box = outbox();
    box.add(null, { id: "a" });
    box.add("me", { id: "a" });
    box.add("me", { id: "a" });
    expect(box.count(null)).toBe(0);
    expect(box.count("me")).toBe(1);
  });

  it("sends oldest first, stops on retry and drops a rejected item", async () => {
    const box = outbox();
    for (const id of ["a", "b", "c"]) box.add("me", { id });
    const answers: Record<string, SendOutcome> = {
      a: "sent",
      b: "rejected",
      c: "retry",
    };
    const seen: string[] = [];
    const sent = await box.drain(
      "me",
      () => true,
      async (item) => {
        seen.push(item.id);
        return answers[item.id];
      },
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(sent).toBe(1);
    expect(box.count("me")).toBe(1);
  });

  it("sends only the current ID's items and drops another ID's", async () => {
    const box = outbox();
    box.add("old", { id: "a" });
    box.add("new", { id: "b" });
    box.keepOnly("new");
    expect(box.count("old")).toBe(0);
    const seen: string[] = [];
    await box.drain(
      "new",
      () => true,
      async (item) => {
        seen.push(item.id);
        return "sent";
      },
    );
    expect(seen).toEqual(["b"]);
  });

  it("survives a reload and sets a broken queue aside without sending it", () => {
    const { storage, map } = memoryStorage();
    outbox(storage).add("me", { id: "a" });
    expect(outbox(storage).count("me")).toBe(1);
    map.set(
      KEY,
      JSON.stringify({ version: 1, pending: [{ accountId: "me" }] }),
    );
    expect(outbox(storage).count("me")).toBe(0);
    expect(map.has(`${KEY}.corrupt`)).toBe(true);
  });

  it("keeps only the newest items past the limit", () => {
    const box = outbox(memoryStorage().storage, 2);
    for (const id of ["a", "b", "c"]) box.add("me", { id });
    expect(box.count("me")).toBe(2);
  });
});
