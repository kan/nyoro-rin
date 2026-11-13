/**
 * Records waiting to be sent, kept per ID (DATA_CONTRACT.md 「履歴の同期」).
 * A record is queued only for the ID the device had when it was made; it is
 * sent only while the device still has that ID, and kept until the server
 * answers. When the device's ID changes, the old ID's records are dropped
 * (the local history keeps the plays themselves).
 *
 * The same queue carries the completed plays and the play logs, each under
 * its own key.
 */
import { type KeyValueStorage, isRecord, readJson, writeJson } from "./storage";

export interface Pending<T> {
  readonly accountId: string;
  readonly item: T;
}

/** What sending one item came to. */
export type SendOutcome =
  /** The server took it (or already had it). */
  | "sent"
  /** The server can never take it; it leaves the queue so others can go. */
  | "rejected"
  /** Try again later (offline, outage, rate limit); sending stops here. */
  | "retry";

export interface OutboxOptions<T> {
  readonly key: string;
  /** Checks one stored item; an outbox with any bad item is set aside. */
  readonly parse: (value: unknown) => T | undefined;
  /** The item's identity: the same item is never queued twice for an ID. */
  readonly idOf: (item: T) => string;
  /** The oldest items go when the queue is longer than this. */
  readonly limit: number;
}

export class Outbox<T> {
  private pending: Pending<T>[];
  private running = false;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly options: OutboxOptions<T>,
  ) {
    // A broken outbox is kept aside by readJson and not sent: what it held
    // cannot be trusted to belong to anyone.
    this.pending =
      readJson(storage, options.key, (value) => parseOutbox(value, options)) ??
      [];
  }

  /** Queues an item for the ID; without an ID nothing is queued. */
  add(accountId: string | null, item: T): void {
    if (!accountId) return;
    const itemId = this.options.idOf(item);
    if (
      this.pending.some(
        (entry) =>
          entry.accountId === accountId &&
          this.options.idOf(entry.item) === itemId,
      )
    ) {
      return;
    }
    this.pending = [...this.pending, { accountId, item }].slice(
      -this.options.limit,
    );
    this.persist();
  }

  count(accountId: string | null): number {
    return this.pending.filter((entry) => entry.accountId === accountId).length;
  }

  /** Drops every item not of this ID: the device's ID changed. */
  keepOnly(accountId: string): void {
    const kept = this.pending.filter((entry) => entry.accountId === accountId);
    if (kept.length === this.pending.length) return;
    this.pending = kept;
    this.persist();
  }

  /**
   * Sends the ID's items oldest first, one at a time, and returns how many
   * the server took. Stops at the first "retry", or when `stillCurrent` says
   * the device's ID has changed.
   */
  async drain(
    accountId: string,
    stillCurrent: () => boolean,
    send: (item: T) => Promise<SendOutcome>,
  ): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      while (stillCurrent()) {
        const next = this.pending.find(
          (entry) => entry.accountId === accountId,
        );
        if (!next) break;
        const outcome = await send(next.item);
        if (outcome === "retry") break;
        this.pending = this.pending.filter((entry) => entry !== next);
        this.persist();
        if (outcome === "sent") sent += 1;
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  private persist(): void {
    writeJson(this.storage, this.options.key, {
      version: 1,
      pending: this.pending,
    });
  }
}

function parseOutbox<T>(
  value: unknown,
  options: OutboxOptions<T>,
): Pending<T>[] | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.pending)
  ) {
    return undefined;
  }
  const pending: Pending<T>[] = [];
  for (const entry of value.pending) {
    if (
      !isRecord(entry) ||
      typeof entry.accountId !== "string" ||
      entry.accountId === ""
    ) {
      return undefined;
    }
    const item = options.parse(entry.item);
    if (item === undefined) return undefined;
    pending.push({ accountId: entry.accountId, item });
  }
  return pending;
}
