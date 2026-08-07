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
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
} from "../../../lib/phonoscope-drivers";

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
