import { describe, expect, it } from "vitest";
import {
  CENTRE_TRANSITION_COMPANIONS,
  effectCatalogue,
  effectGroups,
  effectOptionFor,
  isCompanionEffect,
  newEffectBinding,
} from "./effectCatalogue";
import {
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
} from "../../../lib/phonoscope-drivers";
import { isPhonoscopeSizeControlRelevant } from "../../../lib/phonoscope-effect-groups";

const catalogue = effectCatalogue([]);

const groupNamed = (id: string) => effectGroups(catalogue, [])
  .find((group) => group.id === id);

const parametersNamed = (groupId: string, parameterGroupId: string) =>
  groupNamed(groupId)?.parameterGroups.find((entry) => entry.id === parameterGroupId);

describe("the centre transition's control set", () => {
  it("owns its axis, divisions and return edge rather than offering them", () => {
    for (const companion of CENTRE_TRANSITION_COMPANIONS) {
      const option = effectOptionFor(catalogue, companion.id);
      // Still in the catalogue, because the control set reads its declared
      // range from there — but marked so nothing offers it as an effect.
      expect(option?.companion).toBe(true);
    }
    expect(effectOptionFor(catalogue, PHONOSCOPE_CENTRE_TRANSITION_EFFECT)?.companion)
      .toBeFalsy();
  });

  it("shows each companion only under a mode that uses it", () => {
    const minimumFor = (id: string) =>
      CENTRE_TRANSITION_COMPANIONS.find((companion) => companion.id === id)?.minimumMode;
    // A cross-fade has no axis to collapse along, and only a slide can be cut
    // into pieces or sent back the way it came.
    expect(minimumFor(PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT)).toBe(1);
    expect(minimumFor(PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT)).toBe(2);
    expect(minimumFor(PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT)).toBe(2);
  });

  it("keeps the companions out of the Centre group, so they never list as parameters", () => {
    const centre = effectGroups(catalogue, []).find((group) => group.id === "centre");
    const members = centre?.members.map((member) => member.id) ?? [];
    expect(members).toContain(PHONOSCOPE_CENTRE_TRANSITION_EFFECT);
    for (const companion of CENTRE_TRANSITION_COMPANIONS) {
      expect(members).not.toContain(companion.id);
      expect(isCompanionEffect(companion.id)).toBe(true);
    }
  });

  it("arrives with a ramp, which every transition has", () => {
    const option = effectOptionFor(catalogue, PHONOSCOPE_CENTRE_TRANSITION_EFFECT)!;
    const binding = newEffectBinding("b", option);
    // Pinned to the mode it starts on — it cuts between modes, it does not
    // sweep — but carrying the envelope the transition itself runs on.
    expect(binding.min).toBe(option.default);
    expect(binding.max).toBe(option.default);
    expect(binding.attackSeconds).toBe(0.05);
    expect(binding.holdSeconds).toBe(0);
    expect(binding.releaseSeconds).toBe(0.6);
  });
});

describe("parameter groups", () => {
  it("puts the centre image's size controls in one Size group", () => {
    const size = parametersNamed("centre", "size");
    expect(size?.members.map((member) => member.id)).toEqual([
      PHONOSCOPE_CENTRE_WIDTH_EFFECT,
      PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
      PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
      PHONOSCOPE_MESSAGE_SCALE_EFFECT,
    ]);
    // The centre is always manual: the size mode belongs to the background.
    expect(size?.members.map((member) => member.id))
      .not.toContain(PHONOSCOPE_CENTRE_FIT_EFFECT);
    expect(groupNamed("centre")?.parameterGroups.map((entry) => entry.id))
      .toEqual(["size", "transition"]);
  });

  it("keeps the size mode on the background, which does derive from an image", () => {
    expect(parametersNamed("background", "size")?.members.map((member) => member.id))
      .toEqual([
        PHONOSCOPE_BG_FIT_EFFECT,
        PHONOSCOPE_BG_WIDTH_EFFECT,
        PHONOSCOPE_BG_HEIGHT_EFFECT,
        expect.any(String),
        PHONOSCOPE_BG_SCALE_EFFECT,
      ]);
  });

  it("makes widths and heights ONE integer percentage, not a swept range", () => {
    for (const id of [
      PHONOSCOPE_CENTRE_WIDTH_EFFECT, PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
      PHONOSCOPE_BG_WIDTH_EFFECT, PHONOSCOPE_BG_HEIGHT_EFFECT,
    ]) {
      const option = effectOptionFor(catalogue, id);
      expect(option?.pinned, id).toBe(true);
      expect(option?.unit, id).toBe("%");
      expect(option?.step, id).toBe(1);
    }
    // The scale IS a sweep — it is the one worth binding to a driver lane.
    expect(effectOptionFor(catalogue, PHONOSCOPE_MESSAGE_SCALE_EFFECT)?.pinned).toBeFalsy();
  });

  it("keeps every glow control in one parameter group, which is what shares the ramp", () => {
    const glow = groupNamed("glow");
    expect(glow?.parameterGroups).toHaveLength(1);
    expect(glow?.parameterGroups[0].members.map((member) => member.id)[0])
      .toBe(PHONOSCOPE_GLOW_OPACITY_EFFECT);
  });

  it("lands a module's grid width and height in the Grid effect's Size group", () => {
    const settings = [0, 1].map((index) => ({
      id: index === 0 ? "grid_width" : "grid_height",
      label: index === 0 ? "Grid width" : "Grid height",
      control: "slider" as const,
      min: 0, max: 100, step: 1, default: 100,
      group: "grid",
      updateMode: "smooth" as const,
    }));
    const grid = effectGroups(effectCatalogue(settings), settings)
      .find((group) => group.id === "grid");
    const size = grid?.parameterGroups.find((entry) => entry.id === "size");
    expect(size?.members.map((member) => member.id)).toEqual(["grid_width", "grid_height"]);
    // Screen percentages, so plain sliders — the same rule the picture's are.
    for (const member of size?.members ?? []) {
      expect(member.pinned, member.id).toBe(true);
      expect(member.unit, member.id).toBe("%");
      // "Grid width" reads as "Width" under a heading that already says Grid.
      expect(member.shortLabel).toMatch(/^(Width|Height)$/);
    }
  });

  it("gives dot size its own parameter group, so it does not share the extents' ramp", () => {
    const settings = [
      {
        id: "grid_width", label: "Grid width", control: "slider" as const,
        min: 0, max: 100, step: 1, default: 100,
        group: "grid", updateMode: "smooth" as const,
      },
      {
        id: "dot_size", label: "Dot size", control: "slider" as const,
        min: 0, max: 50, step: 0.1, default: 3.8,
        group: "grid", parameterGroup: "dots", updateMode: "smooth" as const,
      },
    ];
    const grid = effectGroups(effectCatalogue(settings), settings)
      .find((group) => group.id === "grid");
    expect(grid?.parameterGroups.map((entry) => entry.id)).toEqual(["size", "dots", "blend"]);

    const dots = grid?.parameterGroups.find((entry) => entry.id === "dots");
    expect(dots?.members.map((member) => member.id)).toEqual(["dot_size"]);
    const dotSize = dots?.members[0];
    // Real device pixels, and a swept range rather than one pinned number: it is
    // the thing a lane drives.
    expect(dotSize?.unit).toBe("px");
    expect(dotSize?.pinned).toBeFalsy();
    // The heading says Grid, not Dot, so the label is not stripped.
    expect(dotSize?.shortLabel).toBeUndefined();

    // Naming no parameter group still lands in the first one.
    const size = grid?.parameterGroups.find((entry) => entry.id === "size");
    expect(size?.members.map((member) => member.id)).toEqual(["grid_width"]);
    expect(size?.members[0].unit).toBe("%");
    expect(size?.members[0].pinned).toBe(true);
  });
});

describe("which size controls can do anything", () => {
  const relevant = (groupId: string, effectId: string, state: {
    hasImage: boolean; fit: number; proportional: boolean;
  }) => isPhonoscopeSizeControlRelevant(groupId, effectId, state);

  it("never gates the scale, in either slot or any mode", () => {
    for (const [group, id] of [
      ["centre", PHONOSCOPE_MESSAGE_SCALE_EFFECT],
      ["background", PHONOSCOPE_BG_SCALE_EFFECT],
    ] as const) {
      expect(relevant(group, id, { hasImage: false, fit: 0, proportional: true })).toBe(true);
      expect(relevant(group, id, { hasImage: true, fit: 2, proportional: true })).toBe(true);
    }
  });

  it("shows the background's sliders only under Manual", () => {
    const state = (fit: number) => ({ hasImage: true, fit, proportional: false });
    expect(relevant("background", PHONOSCOPE_BG_WIDTH_EFFECT, state(0))).toBe(true);
    expect(relevant("background", PHONOSCOPE_BG_WIDTH_EFFECT, state(1))).toBe(false);
    expect(relevant("background", PHONOSCOPE_BG_HEIGHT_EFFECT, state(2))).toBe(false);
  });

  it("keeps the centre's sliders whatever a stale fit value says", () => {
    // The centre has no size mode any more, so nothing derives its size but
    // Auto — a value left behind by an older configuration must not hide them.
    const state = { hasImage: true, fit: 2, proportional: false };
    expect(relevant("centre", PHONOSCOPE_CENTRE_WIDTH_EFFECT, state)).toBe(true);
    expect(relevant("centre", PHONOSCOPE_CENTRE_HEIGHT_EFFECT, state)).toBe(true);
  });

  it("hides the height under Auto, which derives it from the width", () => {
    const state = { hasImage: true, fit: 0, proportional: true };
    expect(relevant("centre", PHONOSCOPE_CENTRE_HEIGHT_EFFECT, state)).toBe(false);
    expect(relevant("centre", PHONOSCOPE_CENTRE_WIDTH_EFFECT, state)).toBe(true);
    // Auto itself needs an image to take proportions from.
    expect(relevant("centre", PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT, state)).toBe(true);
    expect(relevant("centre", PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
      { ...state, hasImage: false })).toBe(false);
  });
});
