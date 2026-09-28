import { describe, expect, it } from "vitest";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import {
  addMember,
  addState,
  firstAvailableState,
  PERSON_COLOURS,
  presetLabel,
  removeMember,
  removeState,
  renameMember,
  setMemberColor,
  setPrimaryMember,
  targetsWithoutPresets,
  updateState,
} from "./arrival-config-model";

const ada: HouseholdPerson = {
  id: "ada",
  label: "Ada",
  color: "#22d3ee",
  primary: true,
  arrival: [],
  departure: [],
};
const bea: HouseholdPerson = {
  id: "bea",
  label: "Bea",
  color: "#e879f9",
  primary: false,
  arrival: [],
  departure: [],
};
const people = [ada, bea];

describe("member edits", () => {
  it("derives a slug id and the first colour nobody is using", () => {
    expect(addMember([ada], "  Bo  Smith ")).toEqual([
      ada,
      {
        id: "bo-smith",
        label: "Bo Smith",
        color: PERSON_COLOURS[1],
        primary: false,
        arrival: [],
        departure: [],
      },
    ]);
  });

  it("makes the first member of an empty list primary, and no later one", () => {
    const first = addMember([], "Ada");

    expect(first[0].primary).toBe(true);
    expect(addMember(first, "Bea")[1].primary).toBe(false);
  });

  it("refuses an empty label", () => {
    expect(addMember(people, "   ")).toEqual(people);
  });

  it("renames without changing the id the endpoints address", () => {
    expect(renameMember(people, "ada", "Ada L")).toEqual([{ ...ada, label: "Ada L" }, bea]);
    expect(renameMember(people, "ada", "  ")).toEqual(people);
  });

  it("sets a member's colour, lowercased, and leaves the others alone", () => {
    const before = addMember(addMember([], "Ada"), "Bo");

    const after = setMemberColor(before, before[0].id, "#FF4D2E");

    expect(after[0].color).toBe("#ff4d2e");
    expect(after[1].color).toBe(before[1].color);
  });

  it("refuses a colour the schema would reject, rather than saving a broken document", () => {
    // The whole people array is one write: a value the schema refuses loses every
    // other edit in the same save, so the model returns the list it was given.
    const people = addMember([], "Ada");

    for (const bad of ["red", "#ff", "#ff4d2e7", "rgb(255, 77, 46)", ""]) {
      expect(setMemberColor(people, people[0].id, bad)).toEqual(people);
    }
  });

  it("moves primary to exactly one member", () => {
    expect(setPrimaryMember(people, "bea").map((person) => person.primary)).toEqual([false, true]);
  });

  it("keeps the last member, and re-primaries whoever is left", () => {
    expect(removeMember([ada], "ada")).toEqual([ada]);
    expect(removeMember(people, "ada")).toEqual([{ ...bea, primary: true }]);
  });
});

describe("state edits", () => {
  it("appends to the list for the event it names", () => {
    const next = addState(people, "ada", "arrival", { target: "lighting", presetId: "adaptive-office" });

    expect(next[0].arrival).toEqual([{ target: "lighting", presetId: "adaptive-office" }]);
    expect(next[0].departure).toEqual([]);
    expect(next[1]).toEqual(bea);
  });

  it("replaces one state by index", () => {
    const withOne = addState(people, "ada", "arrival", { target: "lighting", presetId: "adaptive-office" });
    const next = updateState(withOne, "ada", "arrival", 0, { target: "volume", presetId: "quiet" });

    expect(next[0].arrival).toEqual([{ target: "volume", presetId: "quiet" }]);
  });

  it("drops one state by index", () => {
    const two = addState(
      addState(people, "ada", "departure", { target: "volume", presetId: "quiet" }),
      "ada",
      "departure",
      { target: "lighting", presetId: "builtin-off:office" },
    );

    expect(removeState(two, "ada", "departure", 0)[0].departure).toEqual([
      { target: "lighting", presetId: "builtin-off:office" },
    ]);
  });

  it("shows a preset that is gone as missing rather than blank", () => {
    expect(presetLabel({ lighting: [{ id: "x", label: "Office · On" }] }, { target: "lighting", presetId: "x" }))
      .toBe("Office · On");
    expect(presetLabel({ lighting: [] }, { target: "lighting", presetId: "gone" }))
      .toBe("Missing preset: gone");
  });
});

describe("which state may be added", () => {
  const targets = [
    { kind: "lighting" as const, label: "Lighting" },
    { kind: "climate" as const, label: "Air conditioning" },
    { kind: "volume" as const, label: "Volume" },
  ];

  it("takes the first target that has a preset", () => {
    expect(firstAvailableState(targets, { lighting: [], climate: [], volume: [{ id: "quiet", label: "Quiet" }] }))
      .toEqual({ target: "volume", presetId: "quiet" });
  });

  it("offers nothing when no target has a preset", () => {
    expect(firstAvailableState(targets, { lighting: [], climate: [], volume: [] })).toBeNull();
  });

  it("lists the targets with no presets yet", () => {
    expect(targetsWithoutPresets(targets, { lighting: [{ id: "on", label: "On" }], climate: [], volume: [] }))
      .toEqual([
        { kind: "climate", label: "Air conditioning" },
        { kind: "volume", label: "Volume" },
      ]);
  });
});
