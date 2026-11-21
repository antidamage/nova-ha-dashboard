import { describe, expect, it } from "vitest";
import { nightCapsFor } from "./night-cap-model";

// specs/home-users.md section 6, including its worked example.

const zoneSettings = [
  { zoneId: "study", bedroom: true, firstHomeLight: false, nightLight: false },
  { zoneId: "loft", bedroom: true, firstHomeLight: false, nightLight: false },
];
const ada = { id: "ada", rooms: ["study", "kitchen", "outside"], quickAccess: [], nightMaxBrightnessPct: 60 };
const bo = {
  id: "bo",
  rooms: ["loft", "kitchen"],
  quickAccess: [{ kind: "room-lights" as const, zoneId: "study" }],
  nightMaxBrightnessPct: 5,
};

const light = (id: string) => ({ entity_id: id, domain: "light" });
const zones = [
  { id: "everything", entities: [light("light.k"), light("light.s"), light("light.l")] },
  { id: "kitchen", entities: [light("light.k"), { entity_id: "switch.neon", domain: "switch", isIllumination: true }] },
  { id: "study", entities: [light("light.s")] },
  { id: "loft", entities: [light("light.l")] },
  { id: "outside", entities: [light("light.o")] },
  { id: "member:bo", special: "member", entities: [light("light.k")] },
];

function caps(home: string[]) {
  return nightCapsFor({ people: [ada, bo], zoneSettings, homeIds: new Set(home), zones });
}

describe("nightCapsFor", () => {
  it("is empty with nobody home", () => {
    expect(caps([])).toEqual({});
  });

  it("caps shared rooms at the lowest maximum of those home, and each bedroom at its owner's", () => {
    expect(caps(["ada", "bo"])).toEqual({
      "light.k": 5,
      "switch.neon": 5,
      // Bo reaches the study only through Quick Access, and it is not Bo's bedroom.
      "light.s": 60,
      "light.l": 5,
    });
  });

  it("lifts the cap back when the low-cap person leaves", () => {
    expect(caps(["ada"])).toEqual({ "light.k": 60, "switch.neon": 60, "light.s": 60 });
  });

  it("never caps the outside zone", () => {
    expect(caps(["ada", "bo"])["light.o"]).toBeUndefined();
  });
});
