import { describe, expect, it } from "vitest";

import { migratePhonoscopeRandomLanes } from "./phonoscope-migrate-v5";

/** The raw stored shape, which is what this conversion runs on. */
function groupWith(lanes: unknown[]) {
  return [{
    id: "group",
    name: "Group",
    moduleId: "particle-ripples",
    lanes,
    combine: {},
    staticSettings: {},
    isDefault: true,
  }];
}

function randomLane(driver: Record<string, unknown>, bindings: unknown[]) {
  return {
    id: "lane",
    driver: { type: "random", every: 1, offset: 0, divide: 1, intervalSeconds: 4, cadence: "beat", ...driver },
    modifiers: [],
    bindings,
  };
}

/** Reach into the converted shape without fighting the `unknown` return. */
function lanesOf(converted: unknown) {
  return (converted as { lanes: { bindings: Record<string, unknown>[] }[] }[])[0].lanes;
}

describe("v5: the random driver splits into timing and value", () => {
  it("turns on randomValue and folds the glide into the attack", () => {
    const converted = migratePhonoscopeRandomLanes(groupWith([
      randomLane({ transitionSeconds: 2.5 }, [
        { id: "b1", effect: "glow", min: 0, max: 10 },
        { id: "b2", effect: "__glowBlur", min: 1, max: 4 },
      ]),
    ]));
    const [binding, second] = lanesOf(converted)[0].bindings;
    expect(binding.randomValue).toBe(true);
    expect(binding.attackSeconds).toBe(2.5);
    // Every binding on the lane, not just the first.
    expect(second.randomValue).toBe(true);
    expect(second.attackSeconds).toBe(2.5);
  });

  it("keeps an authored attack in preference to the glide", () => {
    const converted = migratePhonoscopeRandomLanes(groupWith([
      randomLane({ transitionSeconds: 2.5 }, [
        { id: "b1", effect: "glow", min: 0, max: 10, attackSeconds: 0.2 },
      ]),
    ]));
    expect(lanesOf(converted)[0].bindings[0].attackSeconds).toBe(0.2);
  });

  it("uses the old half-second default when no glide was stored", () => {
    const converted = migratePhonoscopeRandomLanes(groupWith([
      randomLane({}, [{ id: "b1", effect: "glow", min: 0, max: 10 }]),
    ]));
    expect(lanesOf(converted)[0].bindings[0].attackSeconds).toBe(0.5);
  });

  it("clamps a nonsense glide into the range the control offered", () => {
    for (const [stored, expected] of [[-3, 0], [99, 10]] as const) {
      const converted = migratePhonoscopeRandomLanes(groupWith([
        randomLane({ transitionSeconds: stored }, [{ id: "b1", effect: "glow" }]),
      ]));
      expect(lanesOf(converted)[0].bindings[0].attackSeconds).toBe(expected);
    }
  });

  it("leaves every other driver untouched", () => {
    const beatLane = {
      id: "lane", driver: { type: "beat", every: 1 }, modifiers: [],
      bindings: [{ id: "b1", effect: "glow", min: 0, max: 10 }],
    };
    const converted = migratePhonoscopeRandomLanes(groupWith([beatLane]));
    expect(lanesOf(converted)[0]).toEqual(beatLane);
  });

  it("is idempotent, so running it over converted output changes nothing", () => {
    const groups = groupWith([
      randomLane({ transitionSeconds: 2.5 }, [{ id: "b1", effect: "glow", min: 0, max: 10 }]),
    ]);
    const once = migratePhonoscopeRandomLanes(groups);
    expect(migratePhonoscopeRandomLanes(once)).toEqual(once);
  });

  it("survives a malformed configuration rather than throwing", () => {
    expect(migratePhonoscopeRandomLanes(undefined)).toBeUndefined();
    expect(migratePhonoscopeRandomLanes({ notAnArray: true })).toEqual({ notAnArray: true });
    expect(migratePhonoscopeRandomLanes([null, { lanes: "nope" }, { id: "g" }]))
      .toEqual([null, { lanes: "nope" }, { id: "g" }]);
    expect(migratePhonoscopeRandomLanes(groupWith([null, { driver: null }])))
      .toEqual(groupWith([null, { driver: null }]));
  });
});
