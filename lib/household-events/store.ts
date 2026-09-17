// Sole owner of the event spool: the append-only JSONL file, the in-memory
// window over it, and the process-wide log instance.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task } from "../types";
import { COMPACTION_SLACK_RATIO, DEFAULT_MAX_EVENTS, DEFAULT_PATH } from "./constants";
import { normalizedTaskSnapshots, validEvent } from "./normalize-model";
import type { HouseholdEvent, HouseholdEventBatch, HouseholdEventInput } from "./types";

export class HouseholdEventLog {
  private writeQueue = Promise.resolve();
  private loaded = false;
  private events: HouseholdEvent[] = [];
  private nextCursor = 1;
  /** Lines the file still holds that retention has already dropped from memory. */
  private staleLines = 0;
  private readonly compactionSlack: number;

  constructor(
    readonly filePath = process.env.NOVA_DASHBOARD_HOUSEHOLD_EVENTS || DEFAULT_PATH,
    readonly maxEvents = DEFAULT_MAX_EVENTS,
  ) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
      throw new Error("Household event retention must be a positive integer");
    }
    this.compactionSlack = Math.max(1, Math.ceil(maxEvents * COMPACTION_SLACK_RATIO));
  }

  private async load() {
    if (this.loaded) {
      return;
    }
    let skipped = 0;
    try {
      const lines = (await readFile(this.filePath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      // Parse line by line and drop whatever is unusable, rather than mapping
      // JSON.parse across the file and letting one bad line throw.
      //
      // This is not hypothetical. On 2026-08-01, while the host was swap-
      // thrashing, an interrupted append left a single truncated line at the tail
      // of this spool. The previous implementation threw on every load, so the
      // dashboard logged ~46 "Unterminated string" errors per MINUTE and
      // nova-voice's household event polling failed outright — one partial write
      // took the entire event store down until the line was removed by hand.
      //
      // A partial feed is strictly better than no feed: these events are an
      // append-only activity log, not a source of truth, and an unreadable tail
      // must never cost us the 20k good events in front of it.
      const events: HouseholdEvent[] = [];
      for (const line of lines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          skipped += 1;
          continue;
        }
        if (!validEvent(parsed)) {
          skipped += 1;
          continue;
        }
        // `read(after)` paging depends on cursors being strictly increasing, so
        // out-of-order entries are dropped for the same reason as unparseable
        // ones: skipping one event beats serving none.
        const previous = events.at(-1);
        if (previous && parsed.cursor <= previous.cursor) {
          skipped += 1;
          continue;
        }
        events.push(parsed);
      }
      this.events = events.slice(-this.maxEvents);
      // Skipped lines are still physically present, so they count as stale for
      // compaction accounting.
      this.staleLines = events.length - this.events.length + skipped;
      const lastEvent = events.at(-1);
      this.nextCursor = lastEvent ? lastEvent.cursor + 1 : 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.loaded = true;

    if (skipped > 0) {
      console.warn("[nova-dashboard] household event log: skipped unusable lines", {
        filePath: this.filePath,
        skipped,
        kept: this.events.length,
      });
      // Rewrite the spool once so the damage is gone for good instead of being
      // re-skipped on every boot. compact() writes to a temp file and renames,
      // so a crash mid-rewrite leaves the original intact.
      await this.compact();
    }
  }

  private async compact() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const content = this.events.map((event) => JSON.stringify(event)).join("\n");
    try {
      await writeFile(temporary, content ? `${content}\n` : "", "utf8");
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    this.staleLines = 0;
  }

  async append(input: HouseholdEventInput): Promise<HouseholdEvent> {
    let result: HouseholdEvent | undefined;
    const operation = this.writeQueue.then(async () => {
      await this.load();
      const duplicate = this.events.find(
        (event) => event.deduplicationKey === input.deduplicationKey,
      );
      if (duplicate) {
        result = duplicate;
        return;
      }
      const event: HouseholdEvent = {
        ...input,
        version: 1,
        cursor: this.nextCursor,
        id: `dashboard-${this.nextCursor}`,
      };
      this.nextCursor += 1;
      this.events.push(event);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      if (this.events.length > this.maxEvents) {
        this.staleLines += this.events.length - this.maxEvents;
        this.events.splice(0, this.events.length - this.maxEvents);
        if (this.staleLines >= this.compactionSlack) {
          await this.compact();
        }
      }
      result = event;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result!;
  }

  async read(after = 0, limit = 200): Promise<HouseholdEventBatch> {
    await this.writeQueue;
    await this.load();
    const firstAvailableCursor = this.events[0]?.cursor ?? this.nextCursor;
    const resetRequired = after < firstAvailableCursor - 1;
    const effectiveAfter = resetRequired ? firstAvailableCursor - 1 : after;
    const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const events = this.events
      .filter((event) => event.cursor > effectiveAfter)
      .slice(0, boundedLimit);
    return {
      version: 1,
      after,
      firstAvailableCursor,
      nextCursor: events.at(-1)?.cursor ?? effectiveAfter,
      resetRequired,
      events,
    };
  }
}

const globalWithHouseholdEvents = globalThis as typeof globalThis & {
  __novaHouseholdEventLog?: HouseholdEventLog;
};

export const householdEventLog =
  globalWithHouseholdEvents.__novaHouseholdEventLog
  ?? (globalWithHouseholdEvents.__novaHouseholdEventLog = new HouseholdEventLog());

export async function appendHouseholdEvent(input: HouseholdEventInput) {
  return householdEventLog.append(input);
}

export async function appendTaskSnapshotEvents(tasks: Task[]) {
  return Promise.all(normalizedTaskSnapshots(tasks).map((event) => householdEventLog.append(event)));
}
