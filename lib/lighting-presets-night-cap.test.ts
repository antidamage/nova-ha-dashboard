import { describe, expect, it } from "vitest";
import { adaptiveLightBrightnessPctForEntity } from "./lighting-presets";

// specs/home-users.md section 6: the cap is a ceiling at night only, and pinned
// fixtures keep their own look.

const desk = { entity_id: "light.desk" };
const night = { state: "below_horizon" } as never;
const day = { state: "above_horizon" } as never;

describe("night cap in adaptiveLightBrightnessPctForEntity", () => {
  it("lowers the adaptive night brightness to the cap", () => {
    expect(adaptiveLightBrightnessPctForEntity(desk, { nightCapPctByEntity: { "light.desk": 5 } }, night)).toBe(5);
  });

  it("never raises it", () => {
    expect(adaptiveLightBrightnessPctForEntity(desk, { nightCapPctByEntity: { "light.desk": 90 } }, night)).toBe(60);
  });

  it("does nothing by day", () => {
    expect(adaptiveLightBrightnessPctForEntity(desk, { nightCapPctByEntity: { "light.desk": 5 } }, day)).toBe(100);
  });

  it("leaves pinned fixtures alone", () => {
    const lighting = {
      entityPresets: [{ entityId: "light.desk", pinned: true, targetBrightnessPct: { evening: 100 } }],
      nightCapPctByEntity: { "light.desk": 5 },
    };
    expect(adaptiveLightBrightnessPctForEntity(desk, lighting, night)).toBe(100);
  });
});
