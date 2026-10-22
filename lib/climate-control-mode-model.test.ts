import { describe, expect, test } from "vitest";
import { airconControlMode } from "./climate-control/mode-model";
import { airconLegacyActionIntent } from "./climate-control/action-intent-model";

/* The two pure pieces behind "the mode switch is the owner's" — see
 * specs/aircon-auto-control.md §5. */

const mode = (input: Partial<Parameters<typeof airconControlMode>[0]>) =>
  airconControlMode({ storedMode: null, autoMode: false, manualDirection: null, unitOn: false, ...input });

describe("airconControlMode", () => {
  test("a stored Manual stands while the unit rests at target", () => {
    expect(mode({ storedMode: "manual", unitOn: false })).toBe("manual");
  });

  test("a stored Off stands over a unit Home Assistant still reports as running", () => {
    expect(mode({ storedMode: "off", unitOn: true })).toBe("off");
  });

  test("Auto in preferences wins over any stored mode", () => {
    expect(mode({ storedMode: "manual", autoMode: true })).toBe("auto");
  });

  test("with nothing stored it falls back to the old inference", () => {
    expect(mode({ manualDirection: "heat" })).toBe("manual");
    expect(mode({ unitOn: true })).toBe("manual");
    expect(mode({})).toBe("off");
  });
});

const intent = (input: Partial<Parameters<typeof airconLegacyActionIntent>[0]>) =>
  airconLegacyActionIntent({ service: "turn_on", speaksForTheUnit: true, storedMode: null, storedDirection: null, ...input });

describe("airconLegacyActionIntent", () => {
  test("a unit parked on fan only is not the owner choosing Fan", () => {
    const press = { service: "set_fan_mode", remembered: { autoMode: false }, unitState: "fan_only" };
    expect(intent({ ...press, storedMode: "auto" })).toEqual({ mode: "manual", manualDirection: null });
    expect(intent({ ...press, storedMode: "manual" }).manualDirection).toBeNull();
    // With no mode selected, fan only is whatever the owner left it on.
    expect(intent({ ...press, storedMode: "off" }).manualDirection).toBe("fan_only");
  });

  test("choosing Heat by hand selects Manual and seats the direction", () => {
    expect(intent({
      service: "set_hvac_mode",
      hvacMode: "heat",
      remembered: { autoMode: false, hvacMode: "heat" },
    })).toEqual({ mode: "manual", manualDirection: "heat" });
  });

  test("a bare set_hvac_mode from voice or MCP still seats the direction", () => {
    expect(intent({ service: "set_hvac_mode", hvacMode: "cool" }))
      .toEqual({ mode: "manual", manualDirection: "cool" });
  });

  test("arming Auto sends a set_hvac_mode that must not read as Manual", () => {
    expect(intent({
      service: "set_hvac_mode",
      hvacMode: "heat",
      remembered: { autoMode: true, hvacMode: "heat" },
      storedDirection: "cool",
    })).toEqual({ mode: "auto", manualDirection: null });
  });

  test("Auto's bare turn_on does not demote it to Manual", () => {
    expect(intent({ service: "turn_on", storedMode: "auto" }).mode).toBeNull();
  });

  test("Auto resting the compressor at target is not the owner choosing Off", () => {
    expect(intent({ service: "turn_off", remembered: { autoMode: true } }))
      .toEqual({ mode: "auto", manualDirection: null });
  });

  test("a turn_off from anyone else is Off", () => {
    expect(intent({ service: "turn_off", storedMode: "manual", storedDirection: "heat" }))
      .toEqual({ mode: "off", manualDirection: null });
  });

  test("a companion switch's turn_off says nothing about the mode", () => {
    // The aircon's quiet-mode switch resolves to the same instance by name, so a
    // Manual press's own fan-setting housekeeping used to read as the owner
    // choosing Off — and the Manual she had just pressed went out on its own
    // (Adeline, 2026-09-24: "user selected mode should never be unset by any
    // process, ever").
    expect(intent({
      service: "turn_off",
      speaksForTheUnit: false,
      storedMode: "manual",
      storedDirection: "heat",
    })).toEqual({ mode: null, manualDirection: "heat" });
  });

  test("a fan step by hand whose remember rides a companion switch leaves Auto, not Off", () => {
    // The real caller's shape: setFanStep's `remember` rides the LAST action, and
    // when the unit's fan mode already matches the step there is no set_fan_mode
    // to carry it — so it lands on the quiet switch's turn_off
    // (airconFanStepActions, lib/aircon-control/action-model.ts). It must leave
    // Auto for Manual, and must never be read as the owner choosing Off.
    expect(intent({
      service: "turn_off",
      speaksForTheUnit: false,
      remembered: { autoMode: false, fanMode: "low", quietMode: false, turboMode: false },
      storedMode: "auto",
      storedDirection: null,
      unitState: "heat",
    })).toEqual({ mode: "manual", manualDirection: "heat" });
  });

  test("the card's Off press still ends the mode", () => {
    expect(intent({
      service: "turn_off",
      remembered: { autoMode: false, offTimerEndsAt: null },
      storedMode: "manual",
      storedDirection: "heat",
    })).toEqual({ mode: "off", manualDirection: null });
  });

  test("a companion switch's turn_on cannot select a mode either", () => {
    expect(intent({
      service: "turn_on",
      speaksForTheUnit: false,
      storedMode: null,
      storedDirection: null,
    })).toEqual({ mode: null, manualDirection: null });
  });

  test("a fan or setpoint change carrying autoMode:false leaves Auto for Manual", () => {
    expect(intent({ service: "set_fan_mode", remembered: { autoMode: false }, unitState: "heat" }))
      .toEqual({ mode: "manual", manualDirection: "heat" });
  });

  test("a bare setpoint change says nothing about the mode", () => {
    expect(intent({ service: "set_temperature", storedMode: "manual", storedDirection: "heat" }))
      .toEqual({ mode: null, manualDirection: "heat" });
  });
});
