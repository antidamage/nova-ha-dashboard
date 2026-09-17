import { describe, expect, it } from "vitest";
import { orbModuleById, type OrbInfoSources } from "./catalogue";
import { formatOrbValue } from "./format";
import { resolveOrbDisplay } from "./preferences";
import { EMPTY_STATE, NOW, sources } from "./catalogue.fixtures";

describe("parameterised modules", () => {
  const state: NonNullable<OrbInfoSources["dashboardState"]> = {
    ...EMPTY_STATE,
    outsideTemperature: 8, outsideFeelsLike: 6, humidity: 70, rainChancePct: 20,
    uvIndex: 3, windSpeed: 12, forecastHigh: 14, forecastLow: 5,
    wanConnected: true, lightsOn: 3, openingsOpen: 1, unavailableCount: 0,
    zones: [
      { id: "lounge", name: "Lounge", temperatureC: 21.4, humidityPct: 55 },
      { id: "bedroom", name: "Bedroom", temperatureC: 18, humidityPct: null },
    ],
    numericEntities: [
      { entityId: "sensor.tank", name: "Tank", value: 62.5, unit: "%" },
      { entityId: "sensor.fridge", name: "Fridge", value: 3.2, unit: "°C" },
    ],
  };

  it("reads the chosen zone, not the first one", () => {
    const module = orbModuleById("zone-temperature");
    const display = resolveOrbDisplay(undefined, "zone-temperature");
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "bedroom" }), display).text)
      .toBe("18.0°C");
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "lounge" }), display).text)
      .toBe("21.4°C");
  });

  it("reports no reading when the chosen zone has no sensor", () => {
    const output = orbModuleById("zone-humidity").read(sources({ dashboardState: state }), { zoneId: "bedroom" });
    expect(output.status).toBe("unavailable");
  });

  it("reports no reading when no zone has been chosen at all", () => {
    expect(orbModuleById("zone-temperature").read(sources({ dashboardState: state }), {}).status)
      .toBe("unavailable");
  });

  it("signs the indoor/outdoor delta so the direction is the answer", () => {
    const module = orbModuleById("indoor-outdoor-delta");
    const display = resolveOrbDisplay(undefined, "indoor-outdoor-delta");
    // Lounge 21.4 vs outside 8.
    expect(formatOrbValue(module.read(sources({ dashboardState: state }), { zoneId: "lounge" }), display).text)
      .toBe("+13.4°C");
  });

  it("adopts the sensor's own unit for a generic entity readout", () => {
    const module = orbModuleById("entity-numeric");
    // A °C sensor must convert like a temperature...
    const fridge = module.read(sources({ dashboardState: state }), { entityId: "sensor.fridge" });
    expect(fridge.baseUnit).toBe("celsius");
    expect(formatOrbValue(fridge, { ...resolveOrbDisplay(undefined, "entity-numeric"), format: "temperature", unit: "fahrenheit", decimals: 1, showUnit: true }).text)
      .toBe("37.8°F");
    // ...and a % sensor is already a percentage, not a ratio to be scaled.
    const tank = module.read(sources({ dashboardState: state }), { entityId: "sensor.tank" });
    expect(tank.baseUnit).toBe("percent");
    expect(formatOrbValue(tank, { ...resolveOrbDisplay(undefined, "entity-numeric"), format: "percent", decimals: 0, rounding: "round", showUnit: true }).text)
      .toBe("63%");
  });

  it("counts from a chosen date and only alerts when told to", () => {
    const module = orbModuleById("since-date");
    const display = resolveOrbDisplay(undefined, "since-date");
    const since = new Date(NOW - 10 * 24 * 3_600_000).toISOString();
    expect(formatOrbValue(module.read(sources(), { since }), display).text).toBe("10d");
    // 0 days means "never alert", not "alert immediately".
    expect(module.read(sources(), { since, alertAfterDays: 0 }).alert).toBe(false);
    expect(module.read(sources(), { since, alertAfterDays: 7 }).alert).toBe(true);
    expect(module.read(sources(), { since, alertAfterDays: 30 }).alert).toBe(false);
  });

  it("uses the configured ceiling as the power percentage basis", () => {
    const module = orbModuleById("power-headroom");
    const display = resolveOrbDisplay(undefined, "power-headroom");
    const withPower = sources({ power: { currentWatts: 2500, currentCostPerHourNzd: null, generatedAt: null } });
    expect(formatOrbValue(module.read(withPower, { ceilingWatts: 5000 }), display).text).toBe("50%");
    // Unclamped by default: going over the ceiling must be visible.
    expect(formatOrbValue(module.read(withPower, { ceilingWatts: 2000 }), display).text).toBe("125%");
    expect(module.read(withPower, { ceilingWatts: 2000 }).alert).toBe(true);
  });
});
