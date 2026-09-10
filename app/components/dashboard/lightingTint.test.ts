import { describe, expect, it } from "vitest";
import type { DashboardEntity, DashboardState, DashboardZone } from "../../../lib/types";
import { averageLitColor, tintColor } from "./lightingTint";

function light(id: string, state: "on" | "off", rgb: [number, number, number], brightness = 255): DashboardEntity {
  return {
    entity_id: `light.${id}`,
    domain: "light",
    state,
    name: id,
    area_id: "",
    attributes: { rgb_color: rgb, brightness },
  } as DashboardEntity;
}

function zone(id: string, entities: DashboardEntity[]): DashboardZone {
  return {
    id,
    name: id,
    entities,
    counts: {} as DashboardZone["counts"],
    isOn: entities.some((entity) => entity.state === "on"),
    brightnessPct: 100,
  };
}

function state(zones: DashboardZone[]) {
  return { zones } as unknown as DashboardState;
}

describe("averageLitColor", () => {
  it("weights lit lights by brightness and ignores unlit ones", () => {
    const house = zone("everything", [
      light("a", "on", [255, 0, 0], 255),
      light("b", "on", [0, 0, 255], 85),
      light("c", "off", [0, 255, 0]),
    ]);
    const [r, g, b] = averageLitColor(house)!;
    expect(r).toBeGreaterThan(b);
    expect(g).toBe(0);
  });

  it("is null when nothing is lit", () => {
    expect(averageLitColor(zone("everything", [light("a", "off", [255, 0, 0])]))).toBeNull();
  });
});

describe("tintColor", () => {
  const lounge = zone("lounge", [light("desk", "on", [255, 0, 0])]);
  const bedroom = zone("bedroom", [light("bed", "on", [0, 0, 255])]);
  const house = zone("everything", [...lounge.entities, ...bedroom.entities]);

  it("follows the room when the room exists", () => {
    const rgb = tintColor(state([house, lounge, bedroom]), "lounge")!;
    expect(rgb[0]).toBeGreaterThan(rgb[2]);
  });

  it("averages the whole house", () => {
    expect(tintColor(state([house, lounge, bedroom]), "everything")).toEqual(averageLitColor(house));
  });

  it("is null when the room's lights are off", () => {
    const dark = zone("lounge", [light("desk", "off", [255, 0, 0])]);
    expect(tintColor(state([house, dark]), "lounge")).toBeNull();
  });

  it("falls back to the whole house when the zone is missing", () => {
    expect(tintColor(state([house]), "study")).toEqual(averageLitColor(house));
  });
});
