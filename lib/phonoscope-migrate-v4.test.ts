import { describe, expect, it } from "vitest";

import type { PhonoscopeSettingsGroup } from "./types";
import { phonoscopeDriver } from "./phonoscope-drivers";
import {
  migratePhonoscopeModuleSettingsToPercent,
  migratePhonoscopeScalarsToPercent,
  migratePhonoscopeSettingsGroupsToPercent,
} from "./phonoscope-migrate-v4";

function groupWith(bindings: PhonoscopeSettingsGroup["lanes"][number]["bindings"]) {
  return [{
    id: "group",
    name: "Group",
    moduleId: "particle-ripples",
    lanes: [{ id: "lane", driver: phonoscopeDriver({ type: "beat" }), modifiers: [], bindings }],
    combine: {},
    staticSettings: {},
    isDefault: true,
  }] satisfies PhonoscopeSettingsGroup[];
}

describe("v4: geometry authored as a percentage", () => {
  it("scales the resting values of the four geometry axes", () => {
    const scaled = migratePhonoscopeScalarsToPercent({
      __bgHeight: 1 / 3,
      __bgWidth: 1,
      __vignetteOpacity: 0.96,
      grid_width: 1,
      grid_height: 0.3333,
    });
    expect(scaled.__bgHeight).toBeCloseTo(100 / 3, 9);
    expect(scaled.__bgWidth).toBe(100);
    expect(scaled.__vignetteOpacity).toBe(96);
    expect(scaled.grid_width).toBe(100);
    expect(scaled.grid_height).toBeCloseTo(33.33, 9);
  });

  it("leaves every other axis alone", () => {
    // Vignette size is deliberately not a percentage — it is allowed past 1.
    expect(migratePhonoscopeScalarsToPercent({
      __vignetteSize: 1.4,
      __glowOpacity: 40,
      complexity: 0.6,
    })).toEqual({ __vignetteSize: 1.4, __glowOpacity: 40, complexity: 0.6 });
  });

  it("scales per-module resting values", () => {
    expect(migratePhonoscopeModuleSettingsToPercent({
      "particle-ripples": { grid_height: 0.3333, intensity: 0.8 },
      "bpm-pulse": { grid_width: 0.5 },
    })).toEqual({
      "particle-ripples": { grid_height: 33.33, intensity: 0.8 },
      "bpm-pulse": { grid_width: 50 },
    });
  });

  it("scales both ends of a driver lane's range", () => {
    const [group] = migratePhonoscopeSettingsGroupsToPercent(groupWith([
      { id: "a", effect: "__bgHeight", min: 0.2, max: 0.8 },
      { id: "b", effect: "__glowBlur", min: 0.2, max: 0.8 },
    ]));
    expect(group.lanes[0].bindings[0]).toMatchObject({ min: 20, max: 80 });
    // Untouched: the glow blur axis was never a fraction.
    expect(group.lanes[0].bindings[1]).toMatchObject({ min: 0.2, max: 0.8 });
  });

  it("leaves an inherited endpoint absent rather than making it explicit", () => {
    // An absent min/max means "inherit the declared default". Writing an
    // explicit undefined would read as an override that happens to be unset.
    const [group] = migratePhonoscopeSettingsGroupsToPercent(groupWith([
      { id: "a", effect: "__bgWidth", max: 0.5 },
    ]));
    const binding = group.lanes[0].bindings[0];
    expect(binding.max).toBe(50);
    expect("min" in binding).toBe(false);
  });
});
