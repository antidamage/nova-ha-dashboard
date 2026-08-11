import { describe, expect, it } from "vitest";
import {
  COMMANDED_STATE_TIMEOUT_MS,
  actuatorChangeIsExternal,
  climateActionReclaimsOwnership,
  planManualAirconTick,
  poweredActuatorRecoveryIsExternal,
  resolveCommandedState,
} from "./climate-control-policy";

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

  it("preserves a device that reconnects already powered on", () => {
    expect(poweredActuatorRecoveryIsExternal({
      wasAvailable: false,
      currentSignature: JSON.stringify({ power: "on" }),
      commandSettleUntil: 0,
      now: 100,
    })).toBe(true);
    expect(poweredActuatorRecoveryIsExternal({
      wasAvailable: false,
      currentSignature: JSON.stringify({ power: "off" }),
      commandSettleUntil: 0,
      now: 100,
    })).toBe(false);
  });
});

describe("commanded state display", () => {
  // Pressing Off while Auto is armed. The controller keeps reporting "auto"
  // until its own tick sees the Gree off, which is the state the press just
  // cancelled.
  const pressedOff = { value: "off" as const, observedAtPress: "auto" as const, sentAt: 1_000 };

  it("shows the pressed state while the controller still reports the old one", () => {
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "auto",
      owner: "nova",
      now: 1_500,
    })).toEqual({ display: "off", intent: pressedOff });
  });

  it("hands back to the controller once it reports what was asked for", () => {
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "off",
      owner: "nova",
      now: 1_500,
    })).toEqual({ display: "off", intent: null });
  });

  it("holds the press through the controller's transitional reading", () => {
    // Off clears autoMode before the Gree reports off, so the controller reads
    // "manual" for a tick. That is this dashboard's own command in flight, not a
    // new one, and must not flicker the highlight onto Manual.
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "manual",
      owner: "nova",
      now: 1_500,
    })).toEqual({ display: "off", intent: pressedOff });
  });

  it("yields to someone working the unit itself", () => {
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "manual",
      owner: "external",
      now: 1_500,
    })).toEqual({ display: "manual", intent: null });
  });

  it("ignores an external reading left over from before the press", () => {
    // A press reclaims Nova, but this client has not polled that yet, so the
    // stale override must not discard the press.
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "auto",
      owner: "external",
      now: 1_500,
    })).toEqual({ display: "off", intent: pressedOff });
  });

  it("stops claiming a command that never landed", () => {
    expect(resolveCommandedState({
      intent: pressedOff,
      observed: "auto",
      owner: "nova",
      now: 1_000 + COMMANDED_STATE_TIMEOUT_MS,
    })).toEqual({ display: "auto", intent: null });
  });

  it("shows no selection when a press asked for none", () => {
    const clearedMode = { value: null, observedAtPress: "cool" as const, sentAt: 1_000 };
    expect(resolveCommandedState({
      intent: clearedMode,
      observed: "cool",
      owner: "nova",
      now: 1_500,
    })).toEqual({ display: null, intent: clearedMode });
  });

  it("follows the controller with no press outstanding", () => {
    expect(resolveCommandedState({
      intent: null,
      observed: "auto",
      owner: "nova",
      now: 1_500,
    })).toEqual({ display: "auto", intent: null });
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
