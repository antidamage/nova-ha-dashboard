import { describe, expect, it } from "vitest";
import { airconDrySupport, freshSensorValue, planDryEmulationTick, type DryEmulationInput } from "./aircon-dry";

const NOW = Date.parse("2026-09-15T10:00:00Z");
const base: DryEmulationInput = {
  humidityPct: 70,
  roomTemperatureC: 22,
  targetHumidityPct: 55,
  entityState: "off",
  supportedModes: ["off", "heat", "cool", "fan_only"],
  fanModes: ["high", "medium", "low", "quiet"],
  minTemperatureC: 16,
  now: NOW,
  lastTransitionAt: null,
  minDwellMs: 10 * 60_000,
  mayStartFromOff: true,
};

describe("airconDrySupport", () => {
  it("prefers native dry, emulates with sensors, else none", () => {
    expect(airconDrySupport(["cool", "dry"], false)).toBe("native");
    expect(airconDrySupport(["cool", "fan_only"], true)).toBe("emulated");
    expect(airconDrySupport(["cool", "fan_only"], false)).toBeNull();
    // Unavailable units list no modes: never emulated, they may have native dry.
    expect(airconDrySupport([], true)).toBe("unknown");
  });
});

describe("planDryEmulationTick", () => {
  it("cools at the lowest fan, one degree below the room, above target+3", () => {
    expect(planDryEmulationTick({ ...base, humidityPct: 58.5 })).toEqual({ kind: "cool", setpointC: 21, fanMode: "quiet" });
  });

  it("never sets below the device minimum", () => {
    expect(planDryEmulationTick({ ...base, roomTemperatureC: 16.2 })).toMatchObject({ kind: "cool", setpointC: 16 });
  });

  it("switches to fan_only at or below target", () => {
    expect(planDryEmulationTick({ ...base, humidityPct: 55, entityState: "cool" })).toEqual({ kind: "fan_only" });
  });

  it("switches off at target when fan_only is unsupported", () => {
    expect(planDryEmulationTick({ ...base, humidityPct: 50, entityState: "cool", supportedModes: ["cool", "heat"] })).toEqual({ kind: "off" });
  });

  it("holds between target and target+3", () => {
    expect(planDryEmulationTick({ ...base, humidityPct: 57, entityState: "cool" })).toEqual({ kind: "hold", reason: "in-band" });
  });

  it("holds on stale sensors whatever the unit is doing", () => {
    expect(planDryEmulationTick({ ...base, humidityPct: null, entityState: "cool" })).toEqual({ kind: "hold", reason: "stale-sensors" });
    expect(planDryEmulationTick({ ...base, roomTemperatureC: null })).toEqual({ kind: "hold", reason: "stale-sensors" });
  });

  it("never starts an off unit without a fresh request", () => {
    expect(planDryEmulationTick({ ...base, mayStartFromOff: false })).toEqual({ kind: "hold", reason: "off-without-request" });
    expect(planDryEmulationTick({ ...base, entityState: "fan_only", mayStartFromOff: false })).toMatchObject({ kind: "cool" });
  });

  it("respects the compressor dwell", () => {
    expect(planDryEmulationTick({ ...base, lastTransitionAt: NOW - 60_000 })).toEqual({ kind: "hold", reason: "dwell" });
    expect(planDryEmulationTick({ ...base, humidityPct: 50, entityState: "cool", lastTransitionAt: NOW - 60_000 })).toEqual({ kind: "hold", reason: "dwell" });
  });

  it("does not resend a state the unit is already in", () => {
    expect(planDryEmulationTick({ ...base, entityState: "cool" })).toEqual({ kind: "hold", reason: "already" });
    expect(planDryEmulationTick({ ...base, humidityPct: 40, entityState: "fan_only" })).toEqual({ kind: "hold", reason: "already" });
  });
});

describe("freshSensorValue", () => {
  it("rejects stale and unavailable readings", () => {
    const at = new Date(NOW - 60_000).toISOString();
    expect(freshSensorValue({ state: "61", last_reported: at }, NOW)).toBe(61);
    expect(freshSensorValue({ state: "61", last_reported: new Date(NOW - 3_600_000).toISOString() }, NOW)).toBeNull();
    expect(freshSensorValue({ state: "unavailable", last_reported: at }, NOW)).toBeNull();
  });
});
