import { describe, expect, it } from "vitest";
import { actuatorChangeIsExternal, climateActionReclaimsOwnership, planManualAirconTick } from "./climate-control-policy";

describe("climate controller ownership", () => {
  it("treats an unmatched actuator change as external", () => {
    expect(actuatorChangeIsExternal({
      previousSignature: "heat/25/low",
      currentSignature: "off/25/low",
      commandSettleUntil: 0,
      now: 100,
    })).toBe(true);
  });

  it("accepts a correlated Nova command acknowledgement", () => {
    expect(actuatorChangeIsExternal({
      previousSignature: "off/25/low",
      currentSignature: "heat/25/low",
      commandSettleUntil: 200,
      now: 100,
    })).toBe(false);
  });

  it("only explicit power or mode choices reclaim an external override", () => {
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_temperature" })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_fan_mode", autoMode: false })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_temperature", autoMode: true })).toBe(true);
    expect(climateActionReclaimsOwnership({ room: "bedroom", service: "turn_on" })).toBe(true);
  });
});

describe("fixed-direction Manual thermostat", () => {
  const common = {
    direction: "heat" as const,
    filteredTemperature: 21,
    targetTemperature: 25,
    now: 20 * 60_000,
    lastTransitionAt: 0,
    recentStartsAt: [] as number[],
    minOffMs: 10 * 60_000,
    resumeDriftC: 3,
    maxStartsPerHour: 3,
  };

  it("stops heat immediately when the raw Gree reading reaches target", () => {
    expect(planManualAirconTick({ ...common, isOn: true, rawTemperature: 26 })).toBe("stop");
  });

  it("restarts only the selected direction after drift and dwell", () => {
    expect(planManualAirconTick({ ...common, isOn: false, rawTemperature: 24 })).toBe("start");
    expect(planManualAirconTick({ ...common, isOn: false, rawTemperature: 24, filteredTemperature: 23 })).toBe("hold");
  });
});
