import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DashboardState, HaState } from "./types";

/**
 * The claim in docs/config-and-home-assistant.md is that
 * `dashboard-config.default.json` is "generic and complete: a brand-new deploy
 * with no common.json validates and runs". This test is what makes that claim
 * true rather than aspirational.
 *
 * It runs the dashboard against an invented home — a Study and a Garage that
 * exist nowhere but here — with no household overlay and no runtime store, and
 * asserts the projection works and carries nothing of this house.
 */

const GENERIC_AREAS = [
  { area_id: "study", name: "Study" },
  { area_id: "garage", name: "Garage" },
];

const GENERIC_ENTITIES = [
  { entity_id: "light.study_ceiling", area_id: "study", device_id: null, platform: "demo", labels: [] },
  { entity_id: "light.garage_strip", area_id: "garage", device_id: null, platform: "demo", labels: [] },
  { entity_id: "sensor.study_temperature", area_id: "study", device_id: null, platform: "demo", labels: [] },
  { entity_id: "switch.garage_bench", area_id: "garage", device_id: null, platform: "demo", labels: [] },
];

const GENERIC_STATES: HaState[] = [
  {
    entity_id: "light.study_ceiling",
    state: "on",
    attributes: { friendly_name: "Study ceiling", brightness: 180, supported_color_modes: ["brightness"] },
  },
  {
    entity_id: "light.garage_strip",
    state: "off",
    attributes: { friendly_name: "Garage strip", supported_color_modes: ["brightness"] },
  },
  {
    entity_id: "sensor.study_temperature",
    state: "19.5",
    attributes: { friendly_name: "Study temperature", device_class: "temperature", unit_of_measurement: "°C" },
  },
  {
    entity_id: "switch.garage_bench",
    state: "off",
    attributes: { friendly_name: "Garage bench" },
  },
] as unknown as HaState[];

vi.mock("./ha/client", () => {
  const registryByType: Record<string, unknown[]> = {
    "config/area_registry/list": GENERIC_AREAS,
    "config/device_registry/list": [],
    "config/entity_registry/list": GENERIC_ENTITIES,
    "config/label_registry/list": [],
  };
  return {
    haRest: vi.fn(async (path: string) => {
      if (path === "/api/states") return GENERIC_STATES;
      throw new Error(`unexpected haRest path in fresh-install test: ${path}`);
    }),
    haWs: vi.fn(async (type: string) => {
      if (type in registryByType) return registryByType[type];
      throw new Error(`unexpected haWs type in fresh-install test: ${type}`);
    }),
    callService: vi.fn(async () => []),
    callServiceWithResponse: vi.fn(async () => ({ service_response: {} })),
    subscribeHaStateChanges: vi.fn(() => () => {}),
    resetLatestServiceLanesForTest: vi.fn(() => {}),
  };
});

vi.mock("./preferences", () => ({
  readDashboardPreferences: vi.fn(async () => ({})),
  mergeDashboardPreferences: vi.fn(async () => ({})),
}));

/**
 * Serve ONLY what ships in git. No household overlay, no data/ runtime store —
 * exactly what a stranger gets after `git clone`.
 */
function shippedConfigValue() {
  const mergeDeep = (base: unknown, override: unknown): unknown => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return override === undefined ? base : override;
    }
    if (!base || typeof base !== "object" || Array.isArray(base)) return override;
    const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override)) {
      next[key] = key in next ? mergeDeep(next[key], value) : value;
    }
    return next;
  };
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(process.cwd(), "config", name), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  return mergeDeep(mergeDeep(read("dashboard-config.default.json"), read("common.json")), read("tasks.json"));
}

vi.mock("./dashboard-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dashboard-config")>();
  const result = actual.validateDashboardConfig(shippedConfigValue());
  if (!result.ok) {
    throw new Error(
      `The shipped config does not validate on its own, so a fresh deploy cannot start: ${result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
  }
  return {
    ...actual,
    readDashboardConfig: vi.fn(async () => result.config),
    readDashboardConfigSync: vi.fn(() => result.config),
    readDefaultDashboardConfig: vi.fn(async () => result.config),
    readHouseholdDashboardConfig: vi.fn(async () => ({})),
  };
});

/**
 * JSON paths in the shipped config that still hold this household's entities.
 * Each is removed by a numbered phase; the stale check below stops the list
 * outliving the problem.
 */
const SHIPPED_HOUSEHOLD_WAIVERS: Array<{ path: string; reason: string }> = [
  {
    path: "homeAssistant",
    reason:
      "Generic placeholder bindings (weather.forecast_home, sun.sun, sensor.router_*). Auto-detected at runtime; " +
      "the schema requires a string, so these are conventional names rather than any home's devices.",
  },
];

const ENTITY_ID_RE = /^(?:light|switch|sensor|binary_sensor|climate|media_player|button|lock|fan|cover|camera|person|device_tracker|assist_satellite)\.[a-z0-9_]+$/;

/** Every `path -> value` string in the config, depth-first. */
function stringPaths(value: unknown, trail: string[] = []): Array<{ path: string; value: string }> {
  if (typeof value === "string") return [{ path: trail.join("."), value }];
  if (Array.isArray(value)) return value.flatMap((item) => stringPaths(item, trail));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      key.startsWith("_") ? [] : stringPaths(item, [...trail, key]),
    );
  }
  return [];
}

describe("fresh install", () => {
  let state: DashboardState;

  beforeAll(async () => {
    const { buildDashboardState } = await import("./ha");
    state = await buildDashboardState();
  });

  it("builds dashboard state for a home it has never seen", () => {
    expect(state).toBeTruthy();
    expect(state.zones.length).toBeGreaterThan(0);
  });

  it("projects the invented home's rooms, and only those", () => {
    const names = state.zones.map((zone) => zone.name.toLowerCase());
    expect(names).toContain("study");
    expect(names).toContain("garage");
    for (const forbidden of ["lounge", "bedroom", "conservatory", "nook"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("shows no entity belonging to the maintainer's house", () => {
    const ids = state.zones.flatMap((zone) => zone.entities.map((entity) => entity.entity_id));
    const foreign = ids.filter((id) => !GENERIC_ENTITIES.some((entity) => entity.entity_id === id));
    expect(foreign, `these came from somewhere other than the test's home: ${foreign.join(", ")}`).toEqual([]);
  });

  it("keeps household entity ids out of the shipped config", async () => {
    const { readDefaultDashboardConfig } = await import("./dashboard-config");
    const config = await readDefaultDashboardConfig();

    const offenders = stringPaths(config)
      .filter((entry) => ENTITY_ID_RE.test(entry.value))
      .filter((entry) => !SHIPPED_HOUSEHOLD_WAIVERS.some((waiver) => entry.path.startsWith(waiver.path)));

    const report = offenders.map((entry) => `  ${entry.path} -> ${entry.value}`).join("\n");
    expect(
      offenders,
      offenders.length
        ? `Entity ids in the shipped config belong in the nova-household package:\n${report}`
        : undefined,
    ).toEqual([]);
  });

  /**
   * The literal scan covers `lib/` and `app/`; the config check above covers
   * `config/`. Neither looked at `data/`, and household data hid there:
   * `data/power/account-usage.json` was tracked with 24 months of real
   * electricity bills, and two stray atomic-write `.tmp` files carried this
   * home's aircon settings, theme and reminder list. The repo is public.
   *
   * `data/` is per-install runtime state. Nothing in it is source, the deploy
   * excludes it, and every file in it regenerates — so the repo should track
   * almost nothing there.
   */
  it("tracks no per-install runtime data that could carry a household with it", () => {
    let tracked: string[];
    try {
      tracked = execFileSync("git", ["ls-files", "data"], { cwd: process.cwd(), encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // No git available (e.g. a source tarball). Nothing to assert.
      return;
    }

    // Caches of public facts are fine. Anything describing the household is not.
    const ALLOWED = new Set(["data/update/check.json"]);
    const offenders = tracked.filter((file) => !ALLOWED.has(file));

    expect(
      offenders,
      offenders.length
        ? `These are per-install runtime files and must not be tracked — ` +
            `git rm --cached them and add a .gitignore rule:\n${offenders.map((f) => `  ${f}`).join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("has no stale shipped-config waiver", async () => {
    const { readDefaultDashboardConfig } = await import("./dashboard-config");
    const config = await readDefaultDashboardConfig();
    const entries = stringPaths(config).filter((entry) => ENTITY_ID_RE.test(entry.value));

    const stale = SHIPPED_HOUSEHOLD_WAIVERS.filter(
      (waiver) => !entries.some((entry) => entry.path.startsWith(waiver.path)),
    );

    expect(
      stale,
      stale.length ? `Delete these waivers:\n${stale.map((w) => `  ${w.path}`).join("\n")}` : undefined,
    ).toEqual([]);
  });
});
