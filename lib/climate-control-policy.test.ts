import { describe, expect, it } from "vitest";
import {
  COMMANDED_STATE_TIMEOUT_MS,
  actuatorChangeIsExternal,
  climateActionReclaimsOwnership,
  estimateFirstOrderSettledTemperature,
  planManualAirconTick,
  poweredActuatorRecoveryIsExternal,
  resolveCommandedState,
  settlingTrendSupportsSameDirectionRestart,
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
    settlingFromTemperature: null,
    minOffMs: 10 * 60_000,
    sensorSettleMs: 30 * 60_000,
    sensorResolutionC: 1,
    sensorTimeConstantMs: 10 * 60_000,
    resumeDriftC: 1,
  };

  it("stops heat immediately when the raw Gree reading reaches target", () => {
    expect(planManualAirconTick({ ...common, isOn: true, rawTemperature: 26 })).toBe("stop");
  });

  it("waits for the sensor to settle, then restarts the selected direction on one degree of drift", () => {
    expect(planManualAirconTick({ ...common, isOn: false, rawTemperature: 24 })).toBe("hold");
    expect(planManualAirconTick({ ...common, isOn: false, rawTemperature: 24, now: 30 * 60_000 + 1 })).toBe("start");
    expect(planManualAirconTick({ ...common, isOn: false, rawTemperature: 24, filteredTemperature: 25, now: 30 * 60_000 + 1 })).toBe("hold");
  });

  it("does not impose a starts-per-hour limit after settling", () => {
    expect(planManualAirconTick({
      ...common,
      isOn: false,
      rawTemperature: 24,
      now: 30 * 60_000 + 1,
    })).toBe("start");
  });

  it("applies the same settled one-degree restart rule to fixed cooling", () => {
    expect(planManualAirconTick({
      ...common,
      direction: "cool",
      isOn: false,
      rawTemperature: 26,
      filteredTemperature: 26,
      now: 30 * 60_000 + 1,
    })).toBe("start");
  });

  it("restarts fixed heat early when the predicted equilibrium still misses the target", () => {
    expect(planManualAirconTick({
      ...common,
      isOn: false,
      filteredTemperature: 24,
      rawTemperature: 24,
      settlingFromTemperature: 25,
      now: 10 * 60_000 + 1,
    })).toBe("start");
  });

  it("restarts fixed cooling early on the symmetric upward trend", () => {
    expect(planManualAirconTick({
      ...common,
      direction: "cool",
      isOn: false,
      filteredTemperature: 26,
      rawTemperature: 26,
      settlingFromTemperature: 25,
      now: 10 * 60_000 + 1,
    })).toBe("start");
  });
});

describe("first-order sensor settling estimate", () => {
  it("projects the equilibrium from the observed ten-minute heat recovery", () => {
    const estimate = estimateFirstOrderSettledTemperature({
      atTransition: 24,
      current: 23,
      elapsedMs: 10 * 60_000,
      timeConstantMs: 10 * 60_000,
    });
    expect(estimate).toBeCloseTo(22.418, 3);
  });

  it("accelerates only the original direction and only when its target remains unmet", () => {
    const common = {
      atTransition: 24,
      elapsedMs: 10 * 60_000,
      timeConstantMs: 10 * 60_000,
      resumeDriftC: 1,
      measurementResolutionC: 1,
      target: 24,
    };
    expect(settlingTrendSupportsSameDirectionRestart({ ...common, direction: "heat", current: 23 })).toBe(true);
    expect(settlingTrendSupportsSameDirectionRestart({ ...common, direction: "heat", current: 25 })).toBe(false);
    expect(settlingTrendSupportsSameDirectionRestart({ ...common, direction: "cool", current: 25 })).toBe(true);
    expect(settlingTrendSupportsSameDirectionRestart({ ...common, direction: "cool", current: 23 })).toBe(false);
  });

  it("does not mistake ordinary recovery from an overshot stop for an unmet target", () => {
    const common = {
      elapsedMs: 10 * 60_000,
      timeConstantMs: 10 * 60_000,
      resumeDriftC: 1,
      measurementResolutionC: 1,
      target: 24,
    };
    expect(settlingTrendSupportsSameDirectionRestart({
      ...common,
      direction: "heat",
      atTransition: 25,
      current: 24,
    })).toBe(false);
    expect(settlingTrendSupportsSameDirectionRestart({
      ...common,
      direction: "cool",
      atTransition: 23,
      current: 24,
    })).toBe(false);
  });
});
