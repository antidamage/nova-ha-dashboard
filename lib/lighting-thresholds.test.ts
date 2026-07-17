import { describe, expect, it } from "vitest";
import type { DashboardEntity, DashboardLightingConfig } from "./types";
import {
  hasIntensityThreshold,
  intensityThresholdPctForEntity,
  isEntitySuppressedByIntensity,
  splitEntitiesByIntensityThreshold,
} from "./lighting-thresholds";

const lighting: DashboardLightingConfig = {
  intensityThresholds: [
    {
      name: "Neon Lights",
      thresholdPct: 50,
      entityIds: ["light.cupboard_socket_1"],
    },
  ],
};

function light(entity_id: string): DashboardEntity {
  return {
    entity_id,
    domain: "light",
    state: "on",
    name: entity_id,
    area_id: "kitchen",
    attributes: {},
  };
}

describe("lighting intensity thresholds", () => {
  it("suppresses assigned entities below the configured threshold", () => {
    const neon = light("light.cupboard_socket_1");

    expect(hasIntensityThreshold(neon, lighting)).toBe(true);
    expect(intensityThresholdPctForEntity(neon, lighting)).toBe(50);
    expect(isEntitySuppressedByIntensity(neon, 49, lighting)).toBe(true);
    expect(isEntitySuppressedByIntensity(neon, 50, lighting)).toBe(false);
  });

  it("leaves unassigned entities active", () => {
    expect(isEntitySuppressedByIntensity(light("light.kitchen_light_1"), 10, lighting)).toBe(false);
  });

  it("splits mixed entity lists into active and suppressed groups", () => {
    const neon = light("light.cupboard_socket_1");
    const kitchen = light("light.kitchen_light_1");
    const split = splitEntitiesByIntensityThreshold([neon, kitchen], 20, lighting);

    expect(split.suppressed.map((entity) => entity.entity_id)).toEqual(["light.cupboard_socket_1"]);
    expect(split.active.map((entity) => entity.entity_id)).toEqual(["light.kitchen_light_1"]);
  });
});
