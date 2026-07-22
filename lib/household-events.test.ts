import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HouseholdEventLog,
  normalizedHaStateChange,
  normalizedTaskSnapshots,
} from "./household-events";
import type { HaState, Task } from "./types";

const tempDirs: string[] = [];

async function eventLog(maxEvents = 20_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-household-events-"));
  tempDirs.push(directory);
  return new HouseholdEventLog(path.join(directory, "events.json"), maxEvents);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("HouseholdEventLog", () => {
  it("persists monotonic cursors and suppresses duplicate keys across restart", async () => {
    const log = await eventLog();
    const input = {
      occurredAt: "2026-07-22T10:00:00.000Z",
      source: "agent_task" as const,
      kind: "agent_task" as const,
      deduplicationKey: "task:one:active",
      payload: { taskId: "one", status: "active" },
    };

    const first = await log.append(input);
    const duplicate = await log.append({ ...input, occurredAt: "2026-07-22T10:01:00.000Z" });
    const restarted = new HouseholdEventLog(log.filePath);
    const second = await restarted.append({
      ...input,
      deduplicationKey: "task:one:complete",
      payload: { taskId: "one", status: "complete" },
    });

    expect(first.cursor).toBe(1);
    expect(duplicate).toEqual(first);
    expect(second.cursor).toBe(2);
    expect(await restarted.read(1)).toMatchObject({
      resetRequired: false,
      nextCursor: 2,
      events: [{ cursor: 2 }],
    });
  });

  it("reports a cursor reset when retention has removed unread events", async () => {
    const log = await eventLog(2);
    for (let index = 1; index <= 3; index += 1) {
      await log.append({
        occurredAt: `2026-07-22T10:00:0${index}.000Z`,
        source: "dashboard",
        kind: "ha_state",
        deduplicationKey: `event:${index}`,
        payload: { index },
      });
    }

    const batch = await log.read(0);
    expect(batch.resetRequired).toBe(true);
    expect(batch.firstAvailableCursor).toBe(2);
    expect(batch.events.map((event) => event.cursor)).toEqual([2, 3]);
  });
});

function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): HaState {
  return {
    entity_id: entityId,
    state: value,
    attributes,
    last_changed: "2026-07-22T10:00:00.000Z",
  };
}

describe("household event normalization", () => {
  it.each([
    [state("person.addie", "home"), "occupancy"],
    [state("sensor.washer", "unavailable"), "device_health"],
    [state("sensor.washer", "on"), "ha_state"],
    [state("weather.home", "rainy"), "weather"],
    [state("sensor.house_power", "420", { device_class: "power", unit_of_measurement: "W" }), "energy"],
    [state("light.office", "on"), "ha_state"],
  ])("normalizes %s as %s", (newState, kind) => {
    const event = normalizedHaStateChange({
      entityId: newState.entity_id,
      newState,
      oldState: state(newState.entity_id, "off"),
      contextId: "context-1",
    });

    expect(event.kind).toBe(kind);
    expect(event.payload).toMatchObject({ entityId: newState.entity_id, state: newState.state });
    expect(event.deduplicationKey).toMatch(/^ha:/);
  });

  it("normalizes device recovery as device health", () => {
    const event = normalizedHaStateChange({
      entityId: "sensor.washer",
      oldState: state("sensor.washer", "unavailable"),
      newState: state("sensor.washer", "on"),
    });

    expect(event.kind).toBe("device_health");
    expect(event.payload).toMatchObject({ available: true });
  });

  it("creates separate calendar and reminder snapshots", () => {
    const tasks: Task[] = [
      {
        id: "calendar",
        name: "Appointment",
        start: "2026-07-23T10:00:00.000Z",
        createdAt: "2026-07-22T10:00:00.000Z",
        source: "icloud-calendar",
        readOnly: true,
      },
      {
        id: "reminder",
        name: "Put out recycling",
        start: "2026-07-23T18:00:00.000Z",
        createdAt: "2026-07-22T10:00:00.000Z",
        source: "local",
        readOnly: false,
      },
    ];

    const events = normalizedTaskSnapshots(tasks);
    expect(events.map((event) => event.kind)).toEqual(["calendar", "reminder"]);
    expect(events[0].payload).toMatchObject({ tasks: [{ id: "calendar" }] });
    expect(events[1].payload).toMatchObject({ tasks: [{ id: "reminder" }] });
  });
});
