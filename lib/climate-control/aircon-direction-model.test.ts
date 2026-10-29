import { describe, expect, it } from "vitest";
import { airconTickDirection } from "./aircon-direction-model";

/*
 * Which direction the tick reports and drives (specs/aircon-auto-control.md §5.0).
 *
 * Manual reports and drives the seat and nothing else: not the room, not the
 * target, and not `prefs.hvacMode`, which Nova's own Auto leg writes. Auto
 * reports what the unit is doing; its planner chooses its own direction.
 */

const direction = (input: Partial<Parameters<typeof airconTickDirection>[0]>) =>
  airconTickDirection({ mode: "manual", running: null, seated: null, ...input });

describe("airconTickDirection", () => {
  it("drives Manual's seat, whatever the unit is running", () => {
    expect(direction({ seated: "cool" })).toBe("cool");
    expect(direction({ seated: "cool", running: "heat" })).toBe("cool");
  });

  it("never uses the remembered preference as a Manual direction", () => {
    expect(direction({ preferences: { autoMode: false, hvacMode: "cool" } })).toBeNull();
  });

  it("reports the remembered preference for Auto, which chooses its own direction", () => {
    expect(direction({ mode: "auto", preferences: { autoMode: true, hvacMode: "cool" } })).toBe("cool");
    expect(direction({ mode: "auto", running: "heat" })).toBe("heat");
  });

  it("leaves a dry or fan-only status alone, and drives neither", () => {
    expect(direction({ seated: "dry" })).toBe("dry");
    expect(direction({ seated: "fan_only" })).toBe("fan_only");
    expect(direction({ running: "dry" })).toBe("dry");
  });
});
