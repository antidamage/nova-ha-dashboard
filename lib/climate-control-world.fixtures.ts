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
 *
 * `quiet` adds the aircon's quiet-mode switch to the world. It matters because a
 * name-matched companion switch resolves to the same instance as the unit, which
 * is how a `turn_off` aimed at it used to be read as the owner choosing Off.
 */
export function setWorld({
  acState = "off",
  roomTemperature = 22,
  quiet,
  sensorAgeMinutes = 0,
}: {
  acState?: string;
  roomTemperature?: number;
  quiet?: "on" | "off";
  sensorAgeMinutes?: number;
} = {}) {
  const at = new Date(Date.now() - sensorAgeMinutes * 60_000).toISOString();
  world.states = [
    {
      entity_id: "climate.ac",
      state: acState,
      attributes: {
        friendly_name: "Air Conditioner",
        hvac_modes: ["auto", "cool", "dry", "fan_only", "heat", "off"],
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
    ...(quiet
      ? [{
          entity_id: "switch.ac_quiet_mode",
          state: quiet,
          attributes: { friendly_name: "Air Conditioner Quiet mode" },
          last_changed: at, last_updated: at, last_reported: at,
        }]
      : []),
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
/**
 * The unit's own stop. Scoped to the climate entity on purpose: a `turn_off` to
 * one of the aircon's companion switches (its quiet mode) is switching a fan
 * setting off, not stopping the unit, and counting it here would hide that.
 */
export const offCalls = () => world.calls.filter((call) => call.domain === "climate" && call.service === "turn_off");

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

/**
 * Choosing a fan step by hand, in the shape the card really sends it: the
 * `remember` rides the LAST action the press produced, and when the unit's fan
 * mode already matches the step there is no `set_fan_mode` to carry it — so it
 * lands on the quiet switch's `turn_off` (`airconFanStepActions`,
 * `lib/aircon-control/action-model.ts`).
 */
export async function pressCardFanStep(control: Controller) {
  await control.handleLegacyClimateAction({
    entityId: "switch.ac_quiet_mode",
    domain: "switch",
    service: "turn_off",
    remember: { aircon: { autoMode: false, fanMode: "low", quietMode: false, turboMode: false } },
  });
}

/**
 * Pressing Manual on the card the way `useAirconCommands.setOn` sends it: the
 * direction the card chose, the setpoint, the quiet switch's housekeeping, then
 * the fan step. Each action is its own request, exactly as `/api/entity`
 * receives them.
 *
 * It takes the direction as an argument because what the card sends is what the
 * server seats: the direction is the owner's, and the room does not overrule it
 * (manual-direction-model.ts). A press whose direction the room contradicts — heat
 * with the target below the room, which `pressManual` seats in
 * `climate-control-manual-from-off.test.ts` — is therefore a state the tests build
 * on purpose rather than one the server repairs.
 */
export async function pressCardManual(
  control: Controller,
  { direction, temperature }: { direction: "heat" | "cool" | "auto"; temperature?: number },
) {
  const actions = [
    {
      entityId: "climate.ac",
      domain: "climate" as const,
      service: "set_hvac_mode",
      data: { hvac_mode: direction },
      remember: { aircon: { autoMode: false, hvacMode: direction } },
    },
    ...(typeof temperature === "number"
      ? [{
          entityId: "climate.ac",
          domain: "climate" as const,
          service: "set_temperature",
          data: { temperature },
          remember: { aircon: { autoMode: false, temperature } },
        }]
      : []),
    {
      entityId: "switch.ac_quiet_mode",
      domain: "switch" as const,
      service: "turn_off",
      remember: { aircon: { quietMode: false } },
    },
    {
      entityId: "climate.ac",
      domain: "climate" as const,
      service: "set_fan_mode",
      data: { fan_mode: "high" },
      remember: { aircon: { autoMode: false, fanMode: "high" } },
    },
  ];

  for (const action of actions) {
    await control.handleLegacyClimateAction(action);
  }
}
