import { describe, expect, it } from "vitest";
import type { HomeUserState } from "../../../lib/types";
import { emptyRoomsNotice, viewForHomeUser, visibleHomeSelection } from "./view-model";

const zone = (id: string) => ({ id, name: id }) as never;
const tree = {
  inside: zone("everything"),
  climate: zone("climate"),
  indoor: [zone("loft"), zone("den"), zone("kitchen")],
  network: zone("network"),
  outside: zone("outside"),
  world: zone("world"),
  power: null,
} as never;

const person = (rooms: string[], showSystemTabs: boolean) =>
  ({ id: "bo", label: "Bo", color: "#39ff14", rooms, showSystemTabs, quickAccess: [], nightMaxBrightnessPct: 5, home: true, changedAt: null }) as HomeUserState;

describe("viewForHomeUser", () => {
  it("shows everything with no person (undecided or Household)", () => {
    expect(viewForHomeUser(tree, null).indoor).toHaveLength(3);
  });

  it("shows only the person's rooms, and no Home or Systems without system tabs", () => {
    const view = viewForHomeUser(tree, person(["loft", "kitchen"], false));
    expect(view.indoor.map((entry) => entry.id)).toEqual(["loft", "kitchen"]);
    expect(view.inside).toBeNull();
    expect(view.systemsVisible).toBe(false);
    expect(visibleHomeSelection(view, "den")).toBe("loft");
  });

  it("keeps Home and Systems with system tabs", () => {
    const view = viewForHomeUser(tree, person(["den"], true));
    expect(view.inside?.id).toBe("everything");
    expect(view.systemsVisible).toBe(true);
  });

  it("says so when a person has nothing to see", () => {
    expect(emptyRoomsNotice(viewForHomeUser(tree, person([], false)), person([], false))).toMatch(/No rooms are assigned to Bo/);
  });
});
