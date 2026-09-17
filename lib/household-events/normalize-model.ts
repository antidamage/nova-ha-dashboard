// Pure: spool line validation, and the normalisers that turn Home Assistant
// state changes and task lists into event inputs.
import { createHash } from "node:crypto";
import type { HaState, Task } from "../types";
import { HOUSEHOLD_EVENT_KINDS } from "./constants";
import type { HaStateChange, HouseholdEvent, HouseholdEventInput, HouseholdEventKind } from "./types";

export function validEvent(value: unknown): value is HouseholdEvent {
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

function eventFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function entityDomain(entityId: string) {
  return entityId.split(".", 1)[0] ?? "unknown";
}

function stateValue(state: HaState | null | undefined) {
  return typeof state?.state === "string" ? state.state : null;
}

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

