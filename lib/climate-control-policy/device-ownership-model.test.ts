import { describe, expect, it } from "vitest";
import {
  actuatorChangeIsExternal,
  climateActionReclaimsOwnership,
  poweredActuatorRecoveryIsExternal,
} from "./device-ownership-model";

/*
 * Who owns a climate actuator, and who may take it back. Moved here with its
 * module out of `lib/climate-control-policy.ts` (agent-token-footprint §3.3).
 */

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

  it("only explicit power or mode choices aimed at the unit reclaim an external override", () => {
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_temperature", speaksForTheUnit: true })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_fan_mode", autoMode: false, speaksForTheUnit: true })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_temperature", autoMode: true, speaksForTheUnit: true })).toBe(true);
    expect(climateActionReclaimsOwnership({ room: "bedroom", service: "turn_on", speaksForTheUnit: true })).toBe(true);
  });

  it("a companion control that merely resolved to this instance reclaims nothing", () => {
    // The aircon's quiet switch is somebody switching a fan setting, not taking
    // the unit over, and must not latch a request either (2026-09-24).
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "turn_off", speaksForTheUnit: false })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "turn_on", speaksForTheUnit: false })).toBe(false);
    expect(climateActionReclaimsOwnership({ room: "lounge", service: "set_hvac_mode", speaksForTheUnit: false })).toBe(false);
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
