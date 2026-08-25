import { beforeEach, expect, test, vi } from "vitest";

/*
 * A generic `switch.turn_on` against the bedroom heater used to set
 * `mode: "auto"` as a side effect, arming the server thermostat behind the
 * owner's back — a zone "everything on" control, a scene or an MCP tool call
 * would silently commit the house to heating. The switch still energises; the
 * stored mode is now left alone.
 *
 * See specs/bedroom-heater-control-integrity.md section 5.
 */

type HeaterPatch = { bedroomHeater?: { mode?: unknown } } | undefined;

const mergeDashboardPreferences = vi.fn(async (_patch: HeaterPatch) => undefined);
const executedActions: unknown[] = [];

vi.mock("./preferences", () => ({
  mergeDashboardPreferences,
  readDashboardPreferences: async () => ({ bedroomHeater: { mode: "off", temperature: 20 } }),
}));

vi.mock("./ha/client", () => ({
  callService: async (...args: unknown[]) => {
    executedActions.push(args);
    return [];
  },
  haRest: async () => [
    {
      entity_id: "switch.tuya_mobile_bedroom_heater",
      state: "off",
      attributes: { friendly_name: "Bedroom Heater" },
    },
    {
      entity_id: "sensor.tuya_mobile_bedroom_sensor_temperature",
      state: "18",
      attributes: { friendly_name: "Bedroom Sensor Temperature" },
    },
  ],
}));

vi.mock("./dashboard-config", () => {
  const config = {
    dashboard: {
      aircon: { title: "Lounge", matchTokens: [] },
      bedroomHeater: {
        title: "Bedroom",
        switchEntityIds: ["switch.tuya_mobile_bedroom_heater"],
        temperatureEntityIds: ["sensor.tuya_mobile_bedroom_sensor_temperature"],
        humidityEntityIds: [],
      },
      climate: { airconUnits: [], heaters: [] },
    },
  };
  return {
    readDashboardConfig: async () => config,
    readDashboardConfigSync: () => config,
  };
});

vi.mock("./ha", () => ({
  buildDashboardState: async () => ({ entities: [] }),
}));

beforeEach(() => {
  mergeDashboardPreferences.mockClear();
  executedActions.length = 0;
});

test("a generic switch.turn_on does not write the heater's mode", async () => {
  const { handleLegacyClimateAction } = await import("./climate-control");

  await handleLegacyClimateAction({
    entityId: "switch.tuya_mobile_bedroom_heater",
    domain: "switch",
    service: "turn_on",
  });

  const wroteMode = mergeDashboardPreferences.mock.calls.some((call) => {
    return call[0]?.bedroomHeater?.mode !== undefined;
  });
  expect(wroteMode).toBe(false);
});

test("turn_off still fails the heater closed by storing mode off", async () => {
  const { handleLegacyClimateAction } = await import("./climate-control");

  await handleLegacyClimateAction({
    entityId: "switch.tuya_mobile_bedroom_heater",
    domain: "switch",
    service: "turn_off",
  });

  const modes = mergeDashboardPreferences.mock.calls
    .map((call) => call[0]?.bedroomHeater?.mode)
    .filter((mode) => mode !== undefined);
  expect(modes).toContain("off");
});
