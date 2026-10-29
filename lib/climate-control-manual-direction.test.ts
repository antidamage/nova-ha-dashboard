import { describe, expect, test } from "vitest";
import { manualAirconDirection, seatManualDirection } from "./climate-control/manual-direction-model";

/*
 * Which direction Manual runs (specs/aircon-auto-control.md §5.0, §5.3).
 *
 * Manual only ever does what the owner set — inviolable. The seat is the answer
 * whatever the room or the target does; the room decides nothing on a tick. An
 * empty seat is filled once by `seatManualDirection` and stored, so it is a
 * default, never a change. On 2026-10-29 the room deciding on every tick turned a
 * Cool target raised 22 -> 23 over a 22 degree room into heating.
 */

const direction = (input: Partial<Parameters<typeof manualAirconDirection>[0]>) =>
  manualAirconDirection({ dictated: null, running: null, ...input });

const seat = (input: Partial<Parameters<typeof seatManualDirection>[0]>) =>
  seatManualDirection({ running: null, measured: null, target: null, remembered: undefined, ...input });

describe("manualAirconDirection", () => {
  test("the seated direction is the answer, whatever the unit is running", () => {
    expect(direction({ dictated: "heat" })).toBe("heat");
    expect(direction({ dictated: "cool", running: "heat" })).toBe("cool");
    expect(direction({ dictated: "heat", running: "dry" })).toBe("heat");
  });

  test("with nothing seated there is no direction to drive", () => {
    expect(direction({})).toBeNull();
    expect(direction({ running: "cool" })).toBeNull();
    expect(direction({ running: "heat" })).toBeNull();
  });

  test("dry and fan-only are reported, never driven", () => {
    expect(direction({ dictated: "dry" })).toBeNull();
    expect(direction({ dictated: "fan_only" })).toBeNull();
    expect(direction({ running: "dry" })).toBe("dry");
    expect(direction({ running: "fan_only" })).toBe("fan_only");
  });
});

describe("seatManualDirection", () => {
  test("the heat or cool the unit is running comes first", () => {
    expect(seat({ running: "cool", measured: 22, target: 23 })).toBe("cool");
    expect(seat({ running: "heat", measured: 25, target: 21 })).toBe("heat");
  });

  test("a unit running Dry is seated as Dry, never heat or cool over it", () => {
    expect(seat({ running: "dry", measured: 21, target: 27 })).toBe("dry");
    expect(seat({ running: "dry", measured: 30, target: 27, remembered: "heat" })).toBe("dry");
  });

  test("then the side of the target the room is on", () => {
    expect(seat({ measured: 21, target: 27 })).toBe("heat");
    expect(seat({ measured: 30, target: 27 })).toBe("cool");
  });

  test("the remembered direction does not beat the room (2026-09-24)", () => {
    expect(seat({ measured: 21, target: 27, remembered: "cool" })).toBe("heat");
  });

  test("a room on its target takes the remembered direction", () => {
    expect(seat({ measured: 22, target: 22, remembered: "cool" })).toBe("cool");
    expect(seat({ measured: 22, target: 22, remembered: "auto" })).toBeNull();
    expect(seat({ measured: 22, target: 22 })).toBeNull();
  });

  test("with no reading it does not guess between heat and cool (§5.2)", () => {
    expect(seat({ target: 27, remembered: "cool" })).toBeNull();
    expect(seat({ running: "fan_only", target: 27, remembered: "heat" })).toBeNull();
  });
});
