import { describe, expect, it } from "vitest";
import type { HomeZoneSetting } from "../config-schema/home-users";
import type { HomeUserQuickAccessEntry } from "../config-schema/home-users";
import { decidePresenceActions, describePresenceActions } from "./rules-model";

type Person = { id: string; rooms: string[]; quickAccess: HomeUserQuickAccessEntry[] };

// specs/home-users.md section 5: one test per row of the rule table.

const zones: HomeZoneSetting[] = [
  { zoneId: "study", bedroom: true, firstHomeLight: false, nightLight: false },
  { zoneId: "loft", bedroom: true, firstHomeLight: false, nightLight: false },
  { zoneId: "den", bedroom: true, firstHomeLight: false, nightLight: false },
  { zoneId: "kitchen", bedroom: false, firstHomeLight: true, nightLight: false },
  { zoneId: "outside", bedroom: false, firstHomeLight: false, nightLight: true },
];

// ada's rooms are study and den (both follow her); bo's is the loft.
const ada: Person = {
  id: "ada",
  rooms: ["study", "den", "kitchen", "outside"],
  quickAccess: [],
};
const bo: Person = {
  id: "bo",
  rooms: ["loft", "kitchen"],
  quickAccess: [{ kind: "room-lights" as const, zoneId: "outside" }, { kind: "all-lights" as const }],
};
const guest: Person = { id: "guest", rooms: [], quickAccess: [] };
const people = [ada, bo, guest];

function decide(event: "arrival" | "departure", member: Person, home: string[], sunUp = true) {
  return decidePresenceActions({ event, member, people, zoneSettings: zones, homeBefore: new Set(home), sunUp });
}

const outsideOn = { kind: "lights-on" as const, zones: ["outside"] };

describe("decidePresenceActions", () => {
  it("last one out by day turns every light off and their rooms' heaters off", () => {
    expect(decide("departure", bo, ["bo"])).toEqual([
      { kind: "lights-off-house" },
      { kind: "heater-off", zones: ["loft"] },
    ]);
  });

  it("last one out at night turns the house off, then the outside light on", () => {
    expect(decide("departure", bo, ["bo"], false)).toEqual([
      { kind: "lights-off-house" },
      { kind: "heater-off", zones: ["loft"] },
      outsideOn,
    ]);
  });

  it("leaving while someone stays turns off every room that follows the leaver", () => {
    expect(decide("departure", ada, ["ada", "bo"])).toEqual([
      { kind: "lights-off", zones: ["study", "den"] },
      { kind: "heater-off", zones: ["study", "den"] },
    ]);
  });

  it("leaving at night while someone stays also turns the outside light on", () => {
    expect(decide("departure", ada, ["ada", "bo"], false)).toEqual([
      { kind: "lights-off", zones: ["study", "den"] },
      { kind: "heater-off", zones: ["study", "den"] },
      outsideOn,
    ]);
  });

  it("a room someone still home also owns stays lit", () => {
    const shared = { ...ada, rooms: ["loft", "kitchen"] };
    const actions = decidePresenceActions({
      event: "departure",
      member: bo,
      people: [shared, bo],
      zoneSettings: zones,
      homeBefore: new Set(["ada", "bo"]),
      sunUp: true,
    });
    expect(actions).toEqual([]);
  });

  it("first one home by day lights their own rooms and the first-home rooms, nothing else", () => {
    expect(decide("arrival", ada, [])).toEqual([{ kind: "lights-on", zones: ["study", "den", "kitchen"] }]);
  });

  it("first one home at night also lights the outside", () => {
    expect(decide("arrival", bo, [], false)).toEqual([{ kind: "lights-on", zones: ["loft", "kitchen"] }, outsideOn]);
  });

  it("arriving by day with someone home lights only their own rooms", () => {
    expect(decide("arrival", bo, ["ada"])).toEqual([{ kind: "lights-on", zones: ["loft"] }]);
  });

  it("arriving at night with someone home lights their rooms and the outside, not the kitchen", () => {
    expect(decide("arrival", bo, ["ada"], false)).toEqual([{ kind: "lights-on", zones: ["loft"] }, outsideOn]);
  });

  it("never turns a heater on and never names air conditioning", () => {
    for (const home of [[], ["ada"]]) {
      for (const sunUp of [true, false]) {
        const kinds = decide("arrival", bo, home, sunUp).map((action) => action.kind);
        expect(kinds.every((kind) => kind === "lights-on")).toBe(true);
      }
    }
  });

  it("leaves the night lights off when the sun cannot be read", () => {
    const actions = decidePresenceActions({
      event: "departure",
      member: bo,
      people,
      zoneSettings: zones,
      homeBefore: new Set(["ada", "bo"]),
      sunUp: null,
    });
    expect(actions).toEqual([
      { kind: "lights-off", zones: ["loft"] },
      { kind: "heater-off", zones: ["loft"] },
    ]);
  });

  it("is idempotent: repeating the state someone is already in does nothing, even at night", () => {
    expect(decide("arrival", bo, ["bo"], false)).toEqual([]);
    expect(decide("departure", bo, ["ada"], false)).toEqual([]);
  });

  it("ignores people without rooms when deciding who else is home", () => {
    expect(decide("departure", bo, ["bo", "guest"])[0]).toEqual({ kind: "lights-off-house" });
  });
});

describe("describePresenceActions", () => {
  it("names the whole-house consequence", () => {
    expect(describePresenceActions("Bo", "departure", [{ kind: "lights-off-house" }])).toBe(
      "Mark Bo away? Nobody else is home, so every light turns off.",
    );
  });

  it("says when nothing else changes", () => {
    expect(describePresenceActions("Bo", "arrival", [])).toBe("Mark Bo home? Nothing else changes.");
  });

  it("counts every room an arrival lights, the outside included", () => {
    expect(
      describePresenceActions("Bo", "arrival", [{ kind: "lights-on", zones: ["loft", "kitchen"] }, outsideOn]),
    ).toBe("Mark Bo home? Lights turn on in 3 rooms.");
  });
});
