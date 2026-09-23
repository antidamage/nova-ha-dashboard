import { describe, expect, test } from "vitest";
import { manualAirconDirection } from "./climate-control/manual-direction-model";

/*
 * Which direction Manual runs (specs/aircon-auto-control.md §5.3).
 *
 * The room is the evidence for what "on" means, because a remembered direction
 * is not the owner's dictation — on this aircon Nova's own Auto leg writes it, so
 * it records what the Gree's heat-soaked thermistor last implied. Reading it as
 * the dictation turned a press of Manual in a 21 degree room with a 27 degree
 * target into `set_hvac_mode: cool` and a `turn_off` 41 ms later, on 2026-09-24.
 *
 * Inside one degree of the target the dictation still holds, so a resting unit
 * keeps the light showing the direction it just ran.
 */

const direction = (input: Partial<Parameters<typeof manualAirconDirection>[0]>) =>
  manualAirconDirection({ dictated: null, measured: null, running: null, target: null, ...input });

describe("manualAirconDirection", () => {
  test("a dictated direction the room contradicts is not followed", () => {
    // The 2026-09-24 press: 21 degree room, 27 degree target, "cool" remembered.
    expect(direction({ dictated: "cool", measured: 21, target: 27 })).toBe("heat");
    expect(direction({ dictated: "heat", measured: 30, target: 27 })).toBe("cool");
  });

  test("a dictated direction the room agrees with is kept", () => {
    expect(direction({ dictated: "heat", measured: 21, target: 27 })).toBe("heat");
    expect(direction({ dictated: "cool", measured: 30, target: 27 })).toBe("cool");
  });

  test("the dictation holds within a degree past the target", () => {
    // A thermostat does not reverse over a degree of overshoot, and the resting
    // light keeps naming the direction it just ran (§5.1).
    expect(direction({ dictated: "heat", measured: 22, target: 21 })).toBe("heat");
    expect(direction({ dictated: "cool", measured: 20, target: 21 })).toBe("cool");
    // Past the margin it does.
    expect(direction({ dictated: "heat", measured: 23, target: 21 })).toBe("cool");
    expect(direction({ dictated: "cool", measured: 18, target: 21 })).toBe("heat");
  });

  test("with no dictation the room decides", () => {
    expect(direction({ measured: 21, target: 27 })).toBe("heat");
    expect(direction({ measured: 30, target: 27 })).toBe("cool");
  });

  test("with no usable reading the dictated direction is the answer", () => {
    expect(direction({ dictated: "heat", measured: null, target: 27 })).toBe("heat");
  });

  test("with no reading and no dictation it runs on, so a running unit can still stop", () => {
    expect(direction({ measured: null, running: "cool", target: 27 })).toBe("cool");
    expect(direction({ measured: null, target: 27 })).toBeNull();
  });

  test("a room exactly on its target keeps the dictation, or runs on", () => {
    expect(direction({ dictated: "heat", measured: 27, target: 27 })).toBe("heat");
    expect(direction({ measured: 27, running: "cool", target: 27 })).toBe("cool");
    expect(direction({ measured: 27, target: 27 })).toBeNull();
  });

  test("dry and fan-only are never a direction to drive", () => {
    expect(direction({ dictated: "dry", measured: null, target: 27 })).toBeNull();
    expect(direction({ dictated: "fan_only", measured: null, target: 27 })).toBeNull();
    // And with the room to hand, the room answers instead.
    expect(direction({ dictated: "dry", measured: 30, target: 27 })).toBe("cool");
  });

  test("a unit already running dry or fan-only reports that, not a proposal", () => {
    // Nothing dictated heat or cool, and the unit is doing something this loop
    // cannot drive as heat or cool: say what it is.
    expect(direction({ running: "dry", measured: 21, target: 27 })).toBe("dry");
    expect(direction({ running: "fan_only", measured: 30, target: 27 })).toBe("fan_only");
    // Unless the owner dictated a direction, which still wins.
    expect(direction({ dictated: "heat", running: "dry", measured: 21, target: 27 })).toBe("heat");
  });

  test("no target is no direction to choose from", () => {
    expect(direction({ dictated: "heat", measured: 21, target: null })).toBe("heat");
    expect(direction({ measured: 21, target: null })).toBeNull();
  });
});
