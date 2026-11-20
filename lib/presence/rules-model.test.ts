import { describe, expect, it } from "vitest";
import type { HomeZoneSetting } from "../config-schema/home-users";
import type { HomeUserQuickAccessEntry } from "../config-schema/home-users";
import { decidePresenceActions, describePresenceActions } from "./rules-model";

type Person = { id: string; rooms: string[]; quickAccess: HomeUserQuickAccessEntry[] };

// specs/home-users.md section 5: one test per row of the rule table.

const zones: HomeZoneSetting[] = [
  { zoneId: "study", bedroom: true, arrivalLight: false },
  { zoneId: "loft", bedroom: true, arrivalLight: false },
  { zoneId: "kitchen", bedroom: false, arrivalLight: true },
  { zoneId: "outside", bedroom: false, arrivalLight: true },
];

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

function decide(event: "arrival" | "departure", member: Person, home: string[], sunUp = false) {
  return decidePresenceActions({ event, member, people, zoneSettings: zones, homeBefore: new Set(home), sunUp });
}

describe("decidePresenceActions", () => {
  it("last one out turns every light off and their bedroom heater off", () => {
    expect(decide("departure", bo, ["bo"])).toEqual([
      { kind: "lights-off-house" },
      { kind: "heater-off", zones: ["loft"] },
    ]);
  });

  it("leaving while someone stays turns off only the leaver's bedroom and its heater", () => {
    expect(decide("departure", bo, ["ada", "bo"])).toEqual([
      { kind: "lights-off", zones: ["loft"] },
      { kind: "heater-off", zones: ["loft"] },
    ]);
  });

  it("a bedroom someone still home also owns stays lit", () => {
    const shared = { ...ada, rooms: ["loft", "kitchen"] };
    const actions = decidePresenceActions({
      event: "departure",
      member: bo,
      people: [shared, bo],
      zoneSettings: zones,
      homeBefore: new Set(["ada", "bo"]),
      sunUp: false,
    });
    expect(actions).toEqual([]);
  });

  it("first one home turns on every room they control, Quick Access rooms included", () => {
    expect(decide("arrival", bo, [])).toEqual([{ kind: "lights-on", zones: ["loft", "kitchen", "outside"] }]);
  });

  it("arriving by day with someone home lights only their bedroom", () => {
    expect(decide("arrival", bo, ["ada"], true)).toEqual([{ kind: "lights-on", zones: ["loft"] }]);
  });

  it("arriving after sunset with someone home lights their bedroom plus arrival-light rooms they control", () => {
    expect(decide("arrival", bo, ["ada"], false)).toEqual([
      { kind: "lights-on", zones: ["loft", "kitchen", "outside"] },
    ]);
  });

  it("never turns a heater on and never names air conditioning", () => {
    for (const home of [[], ["ada"]]) {
      for (const sunUp of [true, false]) {
        const kinds = decide("arrival", bo, home, sunUp).map((action) => action.kind);
        expect(kinds).not.toContain("heater-off");
        expect(kinds.every((kind) => kind === "lights-on")).toBe(true);
      }
    }
  });

  it("is idempotent: repeating the state someone is already in does nothing", () => {
    expect(decide("arrival", bo, ["bo"])).toEqual([]);
    expect(decide("departure", bo, ["ada"])).toEqual([]);
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
});
