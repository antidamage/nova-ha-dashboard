import { describe, expect, test } from "vitest";
import { manualAirconDirection } from "./climate-control/manual-direction-model";

/*
 * Which direction Manual runs (specs/aircon-auto-control.md §5.3).
 *
 * The direction is the owner's: it is what maintains the temperature once the
 * room arrives on its own, so a target she moves must not move it (Adeline,
 * 2026-09-25). A room that has gone past the target the other way is therefore
 * not evidence that she wants the other mode — heat seated with a 21 degree
 * target in a 25 degree room waits for the room, it does not cool it.
 *
 * The room names a direction only when nothing is seated, and a remembered one
 * cannot stand in for it: Nova's own Auto leg writes `prefs.hvacMode`, so it
 * records what the Gree's heat-soaked thermistor last implied. Reading it as the
 * dictation turned a press of Manual in a 21 degree room with a 27 degree target
 * into `set_hvac_mode: cool` and a `turn_off` 41 ms later, on 2026-09-24.
 */

const direction = (input: Partial<Parameters<typeof manualAirconDirection>[0]>) =>
  manualAirconDirection({ dictated: null, measured: null, running: null, target: null, ...input });

describe("manualAirconDirection", () => {
  test("the seated direction is kept whatever the room is doing", () => {
    expect(direction({ dictated: "heat", measured: 21, target: 27 })).toBe("heat");
    expect(direction({ dictated: "cool", measured: 30, target: 27 })).toBe("cool");
    // Past the target the other way: the room is not asking for the other mode.
    expect(direction({ dictated: "heat", measured: 23, target: 21 })).toBe("heat");
    expect(direction({ dictated: "cool", measured: 18, target: 21 })).toBe("cool");
  });

  test("a target below the room does not turn heat into cooling", () => {
    // 2026-09-25: heat seated, a 25 degree room, the target moved to 21. Nova ran
    // the unit in cool and the Heat light went with it, repeatedly.
    expect(direction({ dictated: "heat", measured: 25, target: 21 })).toBe("heat");
    expect(direction({ dictated: "heat", running: "cool", measured: 25, target: 21 })).toBe("heat");
  });

  test("with no seat the room decides", () => {
    expect(direction({ measured: 21, target: 27 })).toBe("heat");
    expect(direction({ measured: 30, target: 27 })).toBe("cool");
  });

  test("with no usable reading the seated direction is the answer", () => {
    expect(direction({ dictated: "heat", measured: null, target: 27 })).toBe("heat");
  });

  test("with no reading and no seat it runs on, so a running unit can still stop", () => {
    expect(direction({ measured: null, running: "cool", target: 27 })).toBe("cool");
    expect(direction({ measured: null, target: 27 })).toBeNull();
  });

  test("a room exactly on its target keeps the seat, or runs on", () => {
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
    // Nothing seated, and the unit is doing something this loop cannot drive as
    // heat or cool: say what it is.
    expect(direction({ running: "dry", measured: 21, target: 27 })).toBe("dry");
    expect(direction({ running: "fan_only", measured: 30, target: 27 })).toBe("fan_only");
    // A seated direction, which still wins.
    expect(direction({ dictated: "heat", running: "dry", measured: 21, target: 27 })).toBe("heat");
  });

  test("no target is no direction to choose from", () => {
    expect(direction({ dictated: "heat", measured: 21, target: null })).toBe("heat");
    expect(direction({ measured: 21, target: null })).toBeNull();
  });
});
