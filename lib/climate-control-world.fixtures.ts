import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * The fake house the climate-control loop tests drive: one air conditioner, one
 * temperature reading, and the Home Assistant / preferences boundary recorded
 * rather than called.
 *
 * Shared by `climate-control-manual.test.ts` and
 * `climate-control-blind-sensor.test.ts`. Each of those declares its own
 * `vi.mock` calls (they are hoisted per file) pointing at the factories below.
 */
export type Json = Record<string, unknown>;

type World = {
  /** Every service call the loop made, in order. */
  calls: Array<{ domain: string; service: string; data: Json }>;
  preferences: Json;
  states: Json[];
  statePath: string;
};

/**
 * Pinned to globalThis on purpose. `loadController` calls `vi.resetModules()`, so
 * a mock factory that imports this module afterwards gets a FRESH instance of it
 * — and would then read and write a different world from the test file's. One
 * object behind every instance is what makes the mocks and the assertions agree.
 */
const shared = globalThis as typeof globalThis & { __novaClimateTestWorld?: World };
export const world: World = shared.__novaClimateTestWorld ??= {
  calls: [],
  preferences: {},
  states: [],
  statePath: "",
};

export function merge(target: Json, patch: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge((out[key] as Json) ?? {}, value as Json)
      : value;
  }
  return out;
}

export const preferencesMock = () => ({
  mergeDashboardPreferences: async (patch: Json) => {
    world.preferences = merge(world.preferences, patch);
  },
  readDashboardPreferences: async () => world.preferences,
});

export const haClientMock = () => ({
  callService: async (domain: string, service: string, data: Json) => {
    world.calls.push({ domain, service, data });
    return [];
  },
  haRest: async () => world.states,
});

export const dashboardConfigMock = () => {
  const config = {
    dashboard: {
      aircon: { title: "Lounge", matchTokens: [] },
      bedroomHeater: { title: "Bedroom", switchEntityIds: [], temperatureEntityIds: [], humidityEntityIds: [] },
      climate: {
        airconUnits: [{
          id: "lounge",
          title: "Lounge",
          entityId: "climate.ac",
          matchTokens: [],
          temperatureEntityIds: ["sensor.lounge_temperature"],
          humidityEntityIds: [],
        }],
        heaters: [],
      },
    },
  };
  return { readDashboardConfig: async () => config, readDashboardConfigSync: () => config };
};

/**
 * The Gree reports its own return-air temperature, and that is the control
 * sensor. `sensorAgeMinutes` past AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS (30) is how
 * a lost sensor looks: the attribute is still there, nothing has reported it.
 */
export function setWorld({ acState = "off", roomTemperature = 22, sensorAgeMinutes = 0 } = {}) {
  const at = new Date(Date.now() - sensorAgeMinutes * 60_000).toISOString();
  world.states = [
    {
      entity_id: "climate.ac",
      state: acState,
      attributes: {
        friendly_name: "Air Conditioner",
        hvac_modes: ["off", "heat", "cool", "fan_only"],
        fan_modes: ["low", "medium", "high"],
        min_temp: 16,
        temperature: 21,
        current_temperature: roomTemperature,
      },
      last_changed: at, last_updated: at, last_reported: at,
    },
    {
      entity_id: "sensor.lounge_temperature",
      state: String(roomTemperature),
      attributes: {},
      last_changed: at, last_updated: at, last_reported: at,
    },
  ];
}

export function resetWorld(preferences: Json) {
  world.calls.length = 0;
  world.preferences = preferences;
  setWorld();
}

export async function loadController({ freshStatePath = true } = {}) {
  vi.resetModules();
  // The loop keeps its runtime on globalThis so it survives hot reloads; a reload
  // against the same state file is how durable state is tested.
  delete (globalThis as { __novaClimateControlRuntime?: unknown }).__novaClimateControlRuntime;
  if (freshStatePath) {
    world.statePath = path.join(mkdtempSync(path.join(tmpdir(), "nova-climate-")), "state.json");
  }
  process.env.NOVA_CLIMATE_CONTROL_STATE = world.statePath;
  const module = await import("./climate-control");
  module.stopClimateControlForTest();
  return module;
}

export type Controller = Awaited<ReturnType<typeof loadController>>;

/** A request fires a tick of its own; let it finish before driving another. */
export async function settle(control: Controller) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await control.evaluateClimateControlNow();
  }
}

/** What the card reads: the selected mode and whether the unit is running. */
export async function lounge(control: Controller) {
  return (await control.climateControlState()).lounge;
}

export const hvacCalls = (mode: string) =>
  world.calls.filter((call) => call.service === "set_hvac_mode" && call.data.hvac_mode === mode);
export const offCalls = () => world.calls.filter((call) => call.service === "turn_off");

/** Pressing Manual on the card: a direction plus the remembered settings. */
export async function pressManual(control: Controller, direction: "heat" | "cool" = "heat") {
  await control.handleLegacyClimateAction({
    entityId: "climate.ac",
    domain: "climate",
    service: "set_hvac_mode",
    data: { hvac_mode: direction },
    remember: { aircon: { autoMode: false, hvacMode: direction } },
  });
}
