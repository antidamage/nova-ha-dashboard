import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HaState, Task } from "./types";

export const HOUSEHOLD_EVENT_KINDS = [
  "ha_state",
  "occupancy",
  "device_health",
  "weather",
  "energy",
  "reminder",
  "calendar",
  "agent_task",
] as const;

export type HouseholdEventKind = (typeof HOUSEHOLD_EVENT_KINDS)[number];
export type HouseholdEventSource =
  | "home_assistant"
  | "dashboard"
  | "calendar"
  | "reminder"
  | "agent_task";

export type HouseholdEvent = {
  version: 1;
  cursor: number;
  id: string;
  occurredAt: string;
  source: HouseholdEventSource;
  kind: HouseholdEventKind;
  deduplicationKey: string;
  payload: Record<string, unknown>;
};

export type HouseholdEventInput = Omit<HouseholdEvent, "cursor" | "id" | "version">;

export type HouseholdEventBatch = {
  version: 1;
  after: number;
  firstAvailableCursor: number;
  nextCursor: number;
  resetRequired: boolean;
  events: HouseholdEvent[];
};

const DEFAULT_MAX_EVENTS = 20_000;
const DEFAULT_PATH = path.join(process.cwd(), "data", "household-events.jsonl");

function validEvent(value: unknown): value is HouseholdEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Partial<HouseholdEvent>;
  return event.version === 1
    && Number.isSafeInteger(event.cursor)
    && Number(event.cursor) > 0
    && typeof event.id === "string"
    && typeof event.occurredAt === "string"
    && typeof event.source === "string"
    && HOUSEHOLD_EVENT_KINDS.includes(event.kind as HouseholdEventKind)
    && typeof event.deduplicationKey === "string"
    && Boolean(event.payload)
    && typeof event.payload === "object"
    && !Array.isArray(event.payload);
}

export class HouseholdEventLog {
  private writeQueue = Promise.resolve();
  private loaded = false;
  private events: HouseholdEvent[] = [];
  private nextCursor = 1;

  constructor(
    readonly filePath = process.env.NOVA_DASHBOARD_HOUSEHOLD_EVENTS || DEFAULT_PATH,
    readonly maxEvents = DEFAULT_MAX_EVENTS,
  ) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
      throw new Error("Household event retention must be a positive integer");
    }
  }

  private async load() {
    if (this.loaded) {
      return;
    }
    try {
      const lines = (await readFile(this.filePath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      const events = lines.map((line) => JSON.parse(line) as unknown);
      if (!events.every(validEvent)) {
        throw new Error("Household event log contains an unsupported event schema");
      }
      const cursors = events.map((event) => event.cursor);
      if (cursors.some((cursor, index) => index > 0 && cursor <= cursors[index - 1])) {
        throw new Error("Household event log cursors are not strictly increasing");
      }
      this.events = events.slice(-this.maxEvents) as HouseholdEvent[];
      const lastEvent = events.at(-1) as HouseholdEvent | undefined;
      this.nextCursor = lastEvent ? lastEvent.cursor + 1 : 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.loaded = true;
  }

  private async compact() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const content = this.events.map((event) => JSON.stringify(event)).join("\n");
    await writeFile(temporary, content ? `${content}\n` : "", "utf8");
    await rename(temporary, this.filePath);
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
        this.events.splice(0, this.events.length - this.maxEvents);
        await this.compact();
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

function eventFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function entityDomain(entityId: string) {
  return entityId.split(".", 1)[0] ?? "unknown";
}

function stateValue(state: HaState | null | undefined) {
  return typeof state?.state === "string" ? state.state : null;
}

export type HaStateChange = {
  contextId?: string;
  entityId: string;
  oldState?: HaState | null;
  newState?: HaState | null;
};

export function normalizedHaStateChange(change: HaStateChange): HouseholdEventInput {
  const domain = entityDomain(change.entityId);
  const state = stateValue(change.newState);
  const previousState = stateValue(change.oldState);
  const attributes = change.newState?.attributes ?? {};
  const deviceClass = typeof attributes.device_class === "string"
    ? attributes.device_class
    : null;
  const unit = typeof attributes.unit_of_measurement === "string"
    ? attributes.unit_of_measurement
    : null;
  const unavailable = state === "unavailable" || state === "unknown" || state === null;
  const wasUnavailable = previousState === "unavailable" || previousState === "unknown";
  let kind: HouseholdEventKind = "ha_state";
  if (unavailable || wasUnavailable) {
    kind = "device_health";
  } else if (
    domain === "person"
    || domain === "device_tracker"
    || (domain === "binary_sensor" && ["occupancy", "motion", "presence"].includes(deviceClass ?? ""))
  ) {
    kind = "occupancy";
  } else if (domain === "weather") {
    kind = "weather";
  } else if (
    domain === "sensor"
    && (["energy", "power"].includes(deviceClass ?? "") || ["kWh", "Wh", "W", "kW"].includes(unit ?? ""))
  ) {
    kind = "energy";
  }
  const occurredAt = change.newState?.last_changed
    ?? change.newState?.last_updated
    ?? new Date().toISOString();
  const payload = {
    entityId: change.entityId,
    domain,
    state,
    previousState,
    available: !unavailable,
    ...(deviceClass ? { deviceClass } : {}),
    ...(unit ? { unit } : {}),
  };
  return {
    occurredAt,
    source: "home_assistant",
    kind,
    deduplicationKey: `ha:${eventFingerprint({
      contextId: change.contextId,
      occurredAt,
      payload,
    })}`,
    payload,
  };
}

function normalizedTask(task: Task) {
  return {
    id: task.id,
    source: task.source ?? "local",
    start: task.start,
    end: task.end ?? null,
    dismissedAt: task.dismissedAt ?? null,
    name: task.name,
  };
}

export function normalizedTaskSnapshots(tasks: Task[]): HouseholdEventInput[] {
  const calendarTasks = tasks
    .filter((task) => task.source === "icloud-calendar")
    .map(normalizedTask);
  const reminderTasks = tasks
    .filter((task) => task.source !== "icloud-calendar")
    .map(normalizedTask);
  return [
    {
      occurredAt: new Date().toISOString(),
      source: "calendar",
      kind: "calendar",
      deduplicationKey: `calendar:${eventFingerprint(calendarTasks)}`,
      payload: { tasks: calendarTasks },
    },
    {
      occurredAt: new Date().toISOString(),
      source: "reminder",
      kind: "reminder",
      deduplicationKey: `reminder:${eventFingerprint(reminderTasks)}`,
      payload: { tasks: reminderTasks },
    },
  ];
}

export async function appendHouseholdEvent(input: HouseholdEventInput) {
  return householdEventLog.append(input);
}

export async function appendTaskSnapshotEvents(tasks: Task[]) {
  return Promise.all(normalizedTaskSnapshots(tasks).map((event) => householdEventLog.append(event)));
}
