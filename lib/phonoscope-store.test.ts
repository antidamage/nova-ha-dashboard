import { describe, expect, it } from "vitest";
import { normalizePhonoscopeSettingsGroups, prunePhonoscopeLanes } from "./phonoscope-store";
import { phonoscopeDriver } from "./phonoscope-drivers";
import type { PhonoscopeDriverLane } from "./types";

const declared = new Set(["intensity", "__glowBlur"]);

function lane(id: string, effects: string[]): PhonoscopeDriverLane {
  return {
    id,
    driver: phonoscopeDriver({ type: "beat" }),
    modifiers: [],
    bindings: effects.map((effect, index) => ({ id: `${id}_b${index}`, effect })),
  };
}

describe("prunePhonoscopeLanes", () => {
  it("keeps a lane the user has just added and not wired up yet", () => {
    // Regression: this used to be dropped, so "Add driver lane" appeared to do
    // nothing — the lane came back from the server already deleted.
    const kept = prunePhonoscopeLanes([lane("fresh", [])], declared);
    expect(kept.map((entry) => entry.id)).toEqual(["fresh"]);
    expect(kept[0].bindings).toEqual([]);
  });

  it("keeps a lane's declared bindings and drops the rest", () => {
    const kept = prunePhonoscopeLanes([lane("mixed", ["intensity", "retired"])], declared);
    expect(kept).toHaveLength(1);
    expect(kept[0].bindings.map((binding) => binding.effect)).toEqual(["intensity"]);
  });

  it("drops a lane whose every binding pointed at a retired setting", () => {
    expect(prunePhonoscopeLanes([lane("stale", ["retired", "gone"])], declared)).toEqual([]);
  });

  it("preserves lane order and the driver stack", () => {
    const lanes = [lane("a", ["intensity"]), lane("b", []), lane("c", ["__glowBlur"])];
    lanes[1].modifiers = [phonoscopeDriver({ type: "bass" })];
    const kept = prunePhonoscopeLanes(lanes, declared);
    expect(kept.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(kept[1].modifiers.map((driver) => driver.type)).toEqual(["bass"]);
  });
});

describe("binding parameter round trip", () => {
  it("keeps a removed override absent instead of re-filling it with a default", () => {
    // Removing "Range" from an effect must make it inherit, so the binding has
    // to survive normalisation with min/max still unset.
    const [lane] = normalizePhonoscopeSettingsGroups([{
      id: "g",
      name: "G",
      moduleId: "m",
      lanes: [{
        id: "l",
        driver: { type: "beat" },
        bindings: [{ id: "b", effect: "intensity", attackSeconds: 0.2 }],
      }],
    }])[0].lanes;
    const [binding] = lane.bindings;
    expect(binding.min).toBeUndefined();
    expect(binding.max).toBeUndefined();
    expect(binding.params).toBeUndefined();
    expect(binding.attackSeconds).toBe(0.2);
  });
});

describe("theme change range", () => {
  it("drops a stored range so the fixed 0-1 pulse is what actually runs", () => {
    const [group] = normalizePhonoscopeSettingsGroups([{
      id: "g", name: "G", moduleId: "m",
      lanes: [{
        id: "l",
        driver: { type: "downbeat" },
        bindings: [{
          id: "b", effect: "__themeChange",
          min: 0.5, max: 0.9, releaseSeconds: 2,
        }],
      }],
    }]);
    const [binding] = group.lanes[0].bindings;
    expect(binding.min).toBeUndefined();
    expect(binding.max).toBeUndefined();
    // The envelope is still the cross-fade and must survive.
    expect(binding.releaseSeconds).toBe(2);
  });
});
