import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardLightingConfig, DashboardState } from "./types";

const buildDashboardState = vi.fn<[], Promise<DashboardState>>();
const callService = vi.fn(async () => undefined);
const mergeDashboardPreferences = vi.fn(async () => undefined);

vi.mock("./state", () => ({ buildDashboardState: () => buildDashboardState() }));
vi.mock("./ha/client", () => ({
  callService: (...args: unknown[]) => callService(...(args as [])),
  haRest: vi.fn(),
  subscribeHaStateChanges: vi.fn(),
}));
vi.mock("./preferences", () => ({
  mergeDashboardPreferences: (...args: unknown[]) => mergeDashboardPreferences(...(args as [])),
}));

const { applyAdaptiveCandlelightTransitions, applyLightingIntensityThresholds, applyPinnedLightPresets, triggerZoneLightRule } = await import("./ha");
const { migrateLightingRules, projectLightingRules } = await import("./zone-light-rules");

function entity(entityId: string, state: string, attributes: Record<string, unknown> = {}): DashboardEntity {
  return { area_id: "den", attributes, domain: entityId.split(".")[0], entity_id: entityId, name: entityId, state } as unknown as DashboardEntity;
}

const lamp = entity("light.lamp_a", "on", { brightness: 200, supported_color_modes: ["color_temp", "hs"] });
const strip = entity("light.strip", "off", { supported_color_modes: ["onoff"] });
const pinnedLamp = entity("light.lamp_b", "on", { brightness: 60, color_mode: "hs", supported_color_modes: ["color_temp", "hs"] });
const zones = [
  { id: "everything", name: "Home", entities: [lamp, strip, pinnedLamp], brightnessPct: 78, counts: { switch: 0 } },
  { id: "den", name: "Den", entities: [lamp, strip], brightnessPct: 78, counts: { switch: 0 } },
  { id: "porch", name: "Porch", entities: [pinnedLamp], brightnessPct: 24, counts: { switch: 0 } },
];

const legacy: DashboardLightingConfig = {
  intensityThresholds: [{ name: "Strip", thresholdPct: 61, entityIds: ["light.strip"] }],
  entityPresets: [{ entityId: "light.lamp_b", pinned: true, targetBrightnessPct: { daytime: 100, evening: 100 }, colorTemperatureOverrideKelvin: { candlelight: 3000, daylight: 3000 } }],
  zoneEvents: [],
  eventSwitchOnEntityIds: [],
};

function state(lighting: DashboardLightingConfig): DashboardState {
  const adaptive = { enabled: true, lastSunState: "below_horizon" as const };
  return {
    entities: [lamp, strip, pinnedLamp],
    lighting: projectLightingRules(lighting),
    preferences: { lighting: { adaptiveCandlelightZones: { everything: { ...adaptive }, den: { ...adaptive }, porch: { ...adaptive } } } },
    sun: { entity_id: "sun.sun", state: "above_horizon" },
    zones,
  } as unknown as DashboardState;
}

async function decisions(lighting: DashboardLightingConfig) {
  buildDashboardState.mockResolvedValue(state(lighting));
  const out: Record<string, unknown[]> = {};
  const passes = [
    ["threshold", applyLightingIntensityThresholds],
    ["pinned", applyPinnedLightPresets],
    ["adaptive", applyAdaptiveCandlelightTransitions],
  ] as const;
  for (const [name, run] of passes) {
    callService.mockClear();
    mergeDashboardPreferences.mockClear();
    await run();
    const stamps = mergeDashboardPreferences.mock.calls.map((call) =>
      Object.entries((call[0] as { lighting: { adaptiveCandlelightZones: Record<string, { enabled?: boolean; lastSunState?: string }> } })
        .lighting.adaptiveCandlelightZones).map(([zoneId, entry]) => `${zoneId}:${entry.enabled}:${entry.lastSunState}`));
    out[name] = [...callService.mock.calls, ...stamps];
  }
  return out;
}

describe("the host runner decides the same after migration", () => {
  beforeEach(() => {
    buildDashboardState.mockReset();
    callService.mockClear();
  });

  it("threshold, pinned and adaptive passes send identical commands", async () => {
    const before = await decisions(legacy);
    const migrated = migrateLightingRules(legacy, zones as never);
    expect(migrated.changed).toBe(true);
    const after = await decisions(migrated.lighting);
    expect(after).toEqual(before);
    expect(before.threshold.length).toBeGreaterThan(0);
    expect(before.pinned.length).toBeGreaterThan(0);
    expect(before.adaptive.length).toBeGreaterThan(0);
  });

  it("a disabled adaptive rule stops that zone's transition", async () => {
    const migrated = migrateLightingRules(legacy, zones as never).lighting;
    const lighting = {
      ...migrated,
      zoneRules: (migrated.zoneRules ?? []).map((rule) => (rule.kind === "adaptive" ? { ...rule, enabled: false } : rule)),
    };
    const out = await decisions(lighting);
    expect(out.adaptive).toEqual([]);
  });

  it("triggering a preset rule sends its value through the zone command", async () => {
    buildDashboardState.mockResolvedValue(state(migrateLightingRules(legacy, zones as never).lighting));
    callService.mockClear();
    await triggerZoneLightRule({ id: "p", zoneId: "den", enabled: true, kind: "preset", value: { hue: 120, saturation: 100, brightnessPct: 40 } });
    const turnOn = callService.mock.calls.find((call) =>
      call[0] === "light" && call[1] === "turn_on" && (call[2] as { entity_id: string }).entity_id === "light.lamp_a");
    expect(turnOn?.[2]).toMatchObject({ brightness_pct: 40 });
  });
});
