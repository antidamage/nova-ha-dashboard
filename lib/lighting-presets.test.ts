import { describe, expect, it } from "vitest";
import type { DashboardEntity } from "./types";
import {
  adaptiveLightBrightnessPctForEntity,
  adaptiveLightColorTemperatureKelvinForEntity,
  adaptiveLightLabel,
  isPinnedLightEntity,
  defaultAdaptiveLightBrightnessPct,
} from "./lighting-presets";

const WARM_WHITE_KELVIN = 3000;
const conservatoryLight = light("light.conservatory_light");
const kitchenLight = light("light.kitchen_light_1");
const lighting = {
  entityPresets: [
    {
      entityId: "light.conservatory_light",
      pinned: true,
      targetBrightnessPct: {
        daytime: 100,
        evening: 100,
      },
      colorTemperatureOverrideKelvin: {
        candlelight: WARM_WHITE_KELVIN,
        daylight: WARM_WHITE_KELVIN,
      },
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

describe("adaptive light presets", () => {
  it("keeps the shipped brightness defaults for unconfigured lights", () => {
    expect(defaultAdaptiveLightBrightnessPct("candlelight")).toBe(60);
    expect(defaultAdaptiveLightBrightnessPct("daylight")).toBe(100);
    expect(adaptiveLightBrightnessPctForEntity(kitchenLight, lighting, "candlelight")).toBe(60);
    expect(adaptiveLightBrightnessPctForEntity(kitchenLight, lighting, "daylight")).toBe(100);
  });

  it("uses per-entity brightness targets when configured", () => {
    expect(adaptiveLightBrightnessPctForEntity(conservatoryLight, lighting, "candlelight")).toBe(100);
    expect(adaptiveLightBrightnessPctForEntity(conservatoryLight, lighting, "daylight")).toBe(100);
  });

  it("uses per-entity color temperature overrides", () => {
    expect(adaptiveLightColorTemperatureKelvinForEntity(conservatoryLight, lighting, "candlelight")).toBe(3000);
    expect(adaptiveLightColorTemperatureKelvinForEntity(conservatoryLight, lighting, "daylight")).toBe(3000);
    expect(adaptiveLightColorTemperatureKelvinForEntity(kitchenLight, lighting, "daylight")).toBeNull();
  });

  it("treats a preset with pinned set as a pinned light", () => {
    expect(isPinnedLightEntity(conservatoryLight, lighting)).toBe(true);
    expect(isPinnedLightEntity(kitchenLight, lighting)).toBe(false);
    expect(
      isPinnedLightEntity(conservatoryLight, {
        entityPresets: [{ entityId: "light.conservatory_light" }],
      }),
    ).toBe(false);
  });

  it("accepts sunlight as a daytime color temperature alias", () => {
    expect(
      adaptiveLightColorTemperatureKelvinForEntity(
        conservatoryLight,
        {
          entityPresets: [
            {
              entityId: "light.conservatory_light",
              colorTemperatureOverrideKelvin: {
                sunlight: 6200,
              },
            },
          ],
        },
        "daylight",
      ),
    ).toBe(6200);
  });

  it("labels the daytime adaptive preset as daylight", () => {
    expect(
      adaptiveLightLabel({
        entity_id: "sun.sun",
        state: "above_horizon",
        nextRising: null,
        nextSetting: null,
      }),
    ).toBe("Daylight");
  });
});
