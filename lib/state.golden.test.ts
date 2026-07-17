import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DashboardState, HaState } from "./types";
import {
  readRegistryFixtures,
  readSnapshotJson,
  SNAPSHOT_DIR,
  stateSkeleton,
  type StateSkeleton,
} from "../test/snapshot-utils";

const fixtures = readRegistryFixtures();

// Mock the HA transport so buildDashboardState runs against the captured
// snapshot instead of live Home Assistant.
vi.mock("./ha/client", () => {
  const registryByType: Record<string, unknown[]> = {
    "config/area_registry/list": fixtures.areas,
    "config/device_registry/list": fixtures.devices,
    "config/entity_registry/list": fixtures.entities,
    "config/label_registry/list": fixtures.labels,
  };
  return {
    haRest: vi.fn(async (p: string) => {
      if (p === "/api/states") return fixtures.states as HaState[];
      throw new Error(`unexpected haRest path in snapshot test: ${p}`);
    }),
    haWs: vi.fn(async (type: string) => {
      if (type in registryByType) return registryByType[type];
      throw new Error(`unexpected haWs type in snapshot test: ${type}`);
    }),
    callService: vi.fn(async () => []),
    callServiceWithResponse: vi.fn(async () => ({ service_response: {} })),
    subscribeHaStateChanges: vi.fn(() => () => {}),
    resetLatestServiceLanesForTest: vi.fn(() => {}),
  };
});

// Preferences are runtime/volatile and not part of the structural skeleton.
vi.mock("./preferences", () => ({
  readDashboardPreferences: vi.fn(async () => ({})),
  mergeDashboardPreferences: vi.fn(async () => ({})),
}));

// Config must be hermetic too: the projection embeds dashboard config (the
// lighting block, thresholds, etc.), and reading the host's config/ would leak
// machine-local overlays (config/common.local.json, data/dashboard-config.json)
// into the skeleton — the golden then only matches on the machine that seeded
// it. Serve the config captured in the snapshot instead: it is the same config
// that produced the live dashboard-state.json fixture.
vi.mock("./dashboard-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dashboard-config")>();
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const readTracked = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(process.cwd(), "config", name), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  // The snapshot config wins where captured; tracked defaults fill config
  // sections added to the schema after the capture (e.g. `update`).
  const mergeDeep = (base: unknown, override: unknown): unknown => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return override === undefined ? base : override;
    }
    if (!base || typeof base !== "object" || Array.isArray(base)) {
      return override;
    }
    const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override)) {
      next[key] = key in next ? mergeDeep(next[key], value) : value;
    }
    return next;
  };
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "ha-snapshot", "config.json"), "utf8"),
  ) as { config: unknown };
  const tracked = mergeDeep(mergeDeep(readTracked("dashboard-config.default.json"), readTracked("common.json")), readTracked("tasks.json"));
  const result = actual.validateDashboardConfig(mergeDeep(tracked, fixture.config));
  if (!result.ok) {
    throw new Error(`ha-snapshot config fixture no longer validates: ${result.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }
  return {
    ...actual,
    readDashboardConfig: vi.fn(async () => result.config),
    readDashboardConfigSync: vi.fn(() => result.config),
    readDefaultDashboardConfig: vi.fn(async () => result.config),
  };
});

const GOLDEN_PATH = path.join(SNAPSHOT_DIR, "expected-skeleton.json");

describe("dashboard state projection (golden snapshot)", () => {
  let computed: StateSkeleton;

  beforeAll(async () => {
    const { buildDashboardState } = await import("./ha");
    computed = stateSkeleton(await buildDashboardState());

    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(computed, null, 2)}\n`, "utf8");
    }
  });

  it("matches the committed structural skeleton", () => {
    expect(existsSync(GOLDEN_PATH), "run once with UPDATE_GOLDEN=1 to seed the golden").toBe(true);
    const golden = readSnapshotJson<StateSkeleton>("expected-skeleton.json");
    expect(computed).toEqual(golden);
  });

  it("matches the live dashboard output captured from nova (zones + classification)", () => {
    const live = stateSkeleton(readSnapshotJson<DashboardState>("dashboard-state.json"));
    // Zone shape: id, name, special, counts, membership.
    expect(computed.zones).toEqual(live.zones);
    // Per-entity classification (domain / area / illumination).
    expect(computed.entities).toEqual(live.entities);
    expect(computed.totals).toEqual(live.totals);
  });
});
