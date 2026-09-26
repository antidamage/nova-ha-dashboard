import { describe, expect, it } from "vitest";
import type { HouseholdPerson } from "../config-schema";
import { arrivalStatesFor, findHouseholdMember, householdMemberNames } from "./member-model";

const ada: HouseholdPerson = {
  id: "ada",
  label: "Ada",
  color: "#22d3ee",
  primary: true,
  arrival: [{ target: "lighting", presetId: "adaptive-office" }],
  departure: [],
};
const bea: HouseholdPerson = {
  id: "bea",
  label: "Bea",
  color: "#e879f9",
  arrival: [],
  departure: [],
};
const people = [ada, bea];

describe("household members", () => {
  it("resolves by id or label, case-insensitively, ignoring surrounding space", () => {
    expect(findHouseholdMember(people, "ada")?.id).toBe("ada");
    expect(findHouseholdMember(people, "Ada")?.id).toBe("ada");
    expect(findHouseholdMember(people, "  Ada  ")?.id).toBe("ada");
    expect(findHouseholdMember(people, "BEA")?.id).toBe("bea");
  });

  it("returns null rather than a near-miss", () => {
    expect(findHouseholdMember(people, "Ad")).toBeNull();
    expect(findHouseholdMember(people, "Ada L")).toBeNull();
    expect(findHouseholdMember(people, "")).toBeNull();
    expect(findHouseholdMember([], "ada")).toBeNull();
  });

  it("lists the labels it does know", () => {
    expect(householdMemberNames(people)).toEqual(["Ada", "Bea"]);
  });

  it("picks the list for the event", () => {
    expect(arrivalStatesFor(ada, "arrival")).toEqual([{ target: "lighting", presetId: "adaptive-office" }]);
    expect(arrivalStatesFor(ada, "departure")).toEqual([]);
  });
});
