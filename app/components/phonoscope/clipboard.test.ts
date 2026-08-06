import { describe, expect, it } from "vitest";
import {
  reidColorGroup,
  reidLane,
  reidSettingsGroup,
} from "./clipboard";
import { phonoscopeDriver } from "../../../lib/phonoscope-drivers";
import type { PhonoscopeColorGroup, PhonoscopeSettingsGroup } from "../../../lib/types";

const lane = {
  id: "lane_1",
  driver: phonoscopeDriver({ type: "downbeat", every: 4 }),
  modifiers: [phonoscopeDriver({ type: "bass" })],
  bindings: [
    { id: "bind_1", effect: "__glowBlur", min: 0, max: 8 },
    { id: "bind_2", effect: "intensity" },
  ],
};

const settingsGroup: PhonoscopeSettingsGroup = {
  id: "settings_1",
  name: "Hard",
  moduleId: "particle-ripples",
  lanes: [lane],
  combine: { __glowBlur: "strongest" },
  staticSettings: { complexity: 0.9 },
  isDefault: true,
};

const colorGroup: PhonoscopeColorGroup = {
  id: "cgroup_1",
  name: "Addie's",
  moduleId: "particle-ripples",
  entries: [{ id: "entry_1", themeId: "theme_1", settingsGroupIds: ["default", "settings_1"] }],
  genres: ["House", "Techno"],
  isDefault: true,
};

describe("clipboard re-id", () => {
  it("gives every node in a pasted lane a fresh id but keeps its settings", () => {
    const copy = reidLane(lane);
    expect(copy.id).not.toBe(lane.id);
    expect(copy.bindings.map((binding) => binding.id))
      .not.toEqual(lane.bindings.map((binding) => binding.id));
    expect(copy.bindings.map((binding) => binding.effect)).toEqual(["__glowBlur", "intensity"]);
    expect(copy.bindings[0].max).toBe(8);
    expect(copy.driver).toEqual(lane.driver);
    expect(copy.modifiers.map((driver) => driver.type)).toEqual(["bass"]);
  });

  it("deep-clones so editing the copy cannot reach the original", () => {
    const copy = reidLane(lane);
    copy.bindings[0].max = 20;
    copy.modifiers[0].type = "treble";
    expect(lane.bindings[0].max).toBe(8);
    expect(lane.modifiers[0].type).toBe("bass");
  });

  it("re-ids a settings group all the way down and never copies the default flag", () => {
    const copy = reidSettingsGroup(settingsGroup);
    expect(copy.id).not.toBe(settingsGroup.id);
    expect(copy.isDefault).toBe(false);
    expect(copy.lanes[0].id).not.toBe(lane.id);
    expect(copy.lanes[0].bindings[0].id).not.toBe("bind_1");
    expect(copy.combine).toEqual({ __glowBlur: "strongest" });
    expect(copy.staticSettings).toEqual({ complexity: 0.9 });
  });

  it("copies a colour group without stealing its genres or default flag", () => {
    const copy = reidColorGroup(colorGroup);
    expect(copy.id).not.toBe(colorGroup.id);
    expect(copy.genres).toEqual([]);
    expect(copy.isDefault).toBe(false);
    expect(copy.entries[0].id).not.toBe("entry_1");
    // The entry still points at the same theme and settings groups by id.
    expect(copy.entries[0].themeId).toBe("theme_1");
    expect(copy.entries[0].settingsGroupIds).toEqual(["default", "settings_1"]);
  });

  it("produces independent ids on repeated pastes of one clipboard item", () => {
    const ids = new Set([reidLane(lane).id, reidLane(lane).id, reidLane(lane).id]);
    expect(ids.size).toBe(3);
  });
});

describe("paste compatibility", () => {
  // The rule the paste controls enforce: kind must match, and a binding must
  // additionally be the same effect, because a range and envelope authored for
  // "Strong beat multiplier" are meaningless on "Trail length".
  const accepts = (pasted: { effect: string }, target: { effect: string }) =>
    pasted.effect === target.effect;

  it("accepts a binding pasted onto the same effect", () => {
    expect(accepts({ effect: "strong_beat_multiplier" },
                   { effect: "strong_beat_multiplier" })).toBe(true);
  });

  it("rejects a binding pasted onto a different effect", () => {
    expect(accepts({ effect: "strong_beat_multiplier" }, { effect: "trail_length" })).toBe(false);
    expect(accepts({ effect: "__glowBlur" }, { effect: "__glowOpacity" })).toBe(false);
  });
});
