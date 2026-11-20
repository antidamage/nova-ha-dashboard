import { describe, expect, it } from "vitest";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import {
  addQuickAccess,
  moveQuickAccess,
  quickAccessOptions,
  removeQuickAccess,
  setZoneFlag,
  toggleRoom,
} from "./home-users-config-model";

const members = [
  { id: "ada", label: "Ada", color: "#ff4500", arrival: [], departure: [] },
] as HouseholdPerson[];

describe("home users config model", () => {
  it("toggles a room on and off", () => {
    const on = toggleRoom(members, "ada", "loft");
    expect(on[0].rooms).toEqual(["loft"]);
    expect(toggleRoom(on, "ada", "loft")[0].rooms).toEqual([]);
  });

  it("adds, orders and removes Quick Access entries, refusing duplicates", () => {
    let next = addQuickAccess(members, "ada", "all-lights");
    next = addQuickAccess(next, "ada", "room-lights:loft");
    expect(addQuickAccess(next, "ada", "all-lights")).toBe(next);
    next = moveQuickAccess(next, "ada", 1, -1);
    expect(next[0].quickAccess).toEqual([{ kind: "room-lights", zoneId: "loft" }, { kind: "all-lights" }]);
    expect(moveQuickAccess(next, "ada", 0, -1)).toBe(next);
    expect(removeQuickAccess(next, "ada", 0)[0].quickAccess).toEqual([{ kind: "all-lights" }]);
  });

  it("sets a zone flag, creating the zone's entry when it has none", () => {
    const zones = setZoneFlag([], "loft", "bedroom", true);
    expect(zones).toEqual([{ zoneId: "loft", bedroom: true, arrivalLight: false }]);
    expect(setZoneFlag(zones, "loft", "arrivalLight", true)[0]).toEqual({ zoneId: "loft", bedroom: true, arrivalLight: true });
  });

  it("offers All lights, each room's lights and every preset but panel content", () => {
    const options = quickAccessOptions(
      [{ id: "loft", name: "Loft" }],
      [
        { id: "heater", name: "Heater", moduleId: "aircon-heater-control" },
        { id: "panel-clock", name: "Clock", moduleId: "panel-content" },
      ],
    );
    expect(options.map((option) => option.value)).toEqual(["all-lights", "room-lights:loft", "preset:heater"]);
  });
});
