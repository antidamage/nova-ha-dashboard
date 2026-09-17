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
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
} from "../../../lib/phonoscope-drivers";
import { isPhonoscopeSizeControlRelevant } from "../../../lib/phonoscope-effect-groups";

const catalogue = effectCatalogue([]);

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
