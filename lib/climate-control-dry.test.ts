import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

/*
 * Emulated Dry through the server loop (specs/aircon-auto-control.md, "Dry
 * emulation"): requests from any caller, turn_off, units whose modes are
 * unknown, and the setpoint it borrows.
 */

type Json = Record<string, unknown>;
const calls: Array<{ domain: string; service: string; data: Json }> = [];
let prefs: Json = {};
let states: Json[] = [];

function merge(target: Json, patch: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge((out[key] as Json) ?? {}, value as Json)
      : value;
  }
  return out;
}

vi.mock("./preferences", () => ({
  mergeDashboardPreferences: async (patch: Json) => {
    prefs = merge(prefs, patch);
  },
  readDashboardPreferences: async () => prefs,
}));

vi.mock("./ha/client", () => ({
  callService: async (domain: string, service: string, data: Json) => {
    calls.push({ domain, service, data });
    return [];
  },
  haRest: async () => states,
}));

vi.mock("./dashboard-config", () => {
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
          humidityEntityIds: ["sensor.lounge_humidity"],
        }],
        heaters: [],
      },
    },
  };
  return { readDashboardConfig: async () => config, readDashboardConfigSync: () => config };
});

vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

function world({ acState = "off", hvacModes = ["off", "heat", "cool", "fan_only"], humidity = "70" } = {}) {
  const at = new Date().toISOString();
  states = [
    {
      entity_id: "climate.ac",
      state: acState,
      attributes: { friendly_name: "Air Conditioner", hvac_modes: hvacModes, fan_modes: ["low", "high"], min_temp: 16, temperature: 23 },
      last_changed: at, last_updated: at, last_reported: at,
    },
    { entity_id: "sensor.lounge_humidity", state: humidity, attributes: {}, last_changed: at, last_updated: at, last_reported: at },
    { entity_id: "sensor.lounge_temperature", state: "24", attributes: {}, last_changed: at, last_updated: at, last_reported: at },
  ];
}

async function load() {
  vi.resetModules();
  // The loop keeps its runtime on globalThis so it survives hot reloads.
  delete (globalThis as { __novaClimateControlRuntime?: unknown }).__novaClimateControlRuntime;
  process.env.NOVA_CLIMATE_CONTROL_STATE = path.join(mkdtempSync(path.join(tmpdir(), "nova-dry-")), "state.json");
  const module = await import("./climate-control");
  module.stopClimateControlForTest();
  return module;
}

/** A request fires a tick of its own; let it finish before driving another. */
async function settle(control: Awaited<ReturnType<typeof load>>) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await control.evaluateClimateControlNow();
  }
}

const hvac = (mode: string) => calls.filter((call) => call.service === "set_hvac_mode" && call.data.hvac_mode === mode);

beforeEach(() => {
  calls.length = 0;
  prefs = { aircon: { autoMode: true, temperature: 21 } };
  world();
});

describe("emulated Dry", () => {
  test("a bare set_hvac_mode dry (voice, MCP) records Dry and leaves Auto", async () => {
    const control = await load();
    await control.handleLegacyClimateAction({ entityId: "climate.ac", domain: "climate", service: "set_hvac_mode", data: { hvac_mode: "dry" } });
    await settle(control);

    expect(hvac("dry")).toHaveLength(0);
    expect((prefs.aircon as Json).autoMode).toBe(false);
    expect((prefs.aircon as Json).hvacMode).toBe("dry");
    expect(hvac("cool")).toHaveLength(1);
    expect(calls).toContainEqual({ domain: "climate", service: "set_temperature", data: { entity_id: "climate.ac", temperature: 23 } });
    expect((await control.climateControlState()).lounge.direction).toBe("dry");
  });

  test("an intent for Dry does the same", async () => {
    const control = await load();
    await control.applyClimateControlIntent({ room: "lounge", mode: "manual", direction: "dry" });
    await settle(control);

    expect(hvac("dry")).toHaveLength(0);
    expect((prefs.aircon as Json).autoMode).toBe(false);
    expect(hvac("cool")).toHaveLength(1);
  });

  test("turn_off ends Dry and the loop does not start the unit again", async () => {
    const control = await load();
    await control.applyClimateControlIntent({ room: "lounge", mode: "manual", direction: "dry" });
    await settle(control);
    await control.handleLegacyClimateAction({ entityId: "climate.ac", domain: "climate", service: "turn_off" });
    calls.length = 0;
    world({ acState: "off" });
    await settle(control);

    expect(hvac("cool")).toHaveLength(0);
    expect((await control.climateControlState()).lounge.mode).toBe("off");
  });

  test("leaving Dry puts the owner's target back", async () => {
    const control = await load();
    await control.applyClimateControlIntent({ room: "lounge", mode: "manual", direction: "dry" });
    await settle(control);
    calls.length = 0;
    world({ acState: "cool" });
    await control.handleLegacyClimateAction({
      entityId: "climate.ac", domain: "climate", service: "set_hvac_mode",
      data: { hvac_mode: "heat" }, remember: { aircon: { autoMode: false, hvacMode: "heat" } },
    });

    expect(calls).toContainEqual({ domain: "climate", service: "set_temperature", data: { entity_id: "climate.ac", temperature: 21 } });
    expect(hvac("heat")).toHaveLength(1);
  });

  test("a unit listing no modes is never emulated: the real dry call goes out", async () => {
    world({ hvacModes: [] });
    const control = await load();
    await control.handleLegacyClimateAction({
      entityId: "climate.ac", domain: "climate", service: "set_hvac_mode",
      data: { hvac_mode: "dry" }, remember: { aircon: { autoMode: false, hvacMode: "dry" } },
    });

    expect(hvac("dry")).toHaveLength(1);
    expect((await control.climateControlState()).lounge.dryEmulatable).toBe(false);
  });

  test("a unit running native dry reports direction dry", async () => {
    prefs = { aircon: { autoMode: false, temperature: 21 } };
    world({ acState: "dry", hvacModes: ["off", "cool", "dry", "fan_only"] });
    const control = await load();
    await control.evaluateClimateControlNow();

    expect((await control.climateControlState()).lounge.direction).toBe("dry");
  });
});
