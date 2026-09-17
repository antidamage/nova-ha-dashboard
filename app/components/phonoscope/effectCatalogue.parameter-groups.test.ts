import { describe, expect, it } from "vitest";
import {
  effectCatalogue,
  effectGroups,
  effectOptionFor,
} from "./effectCatalogue";
import {
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
} from "../../../lib/phonoscope-drivers";

const catalogue = effectCatalogue([]);

const groupNamed = (id: string) => effectGroups(catalogue, [])
  .find((group) => group.id === id);

const parametersNamed = (groupId: string, parameterGroupId: string) =>
  groupNamed(groupId)?.parameterGroups.find((entry) => entry.id === parameterGroupId);

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
      // The EMPTY STRING, which is what the compiler emits for a setting whose
      // manifest names no parameter group — not `undefined`. Written out
      // because a test that omitted the key passed against a fallback that only
      // handled `undefined`, while the real module fell out of the group.
      parameterGroup: "",
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
        group: "grid", parameterGroup: "", updateMode: "smooth" as const,
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

    // `AddEffectControl` binds `members[0]` when you add a whole effect, so the
    // order across parameter groups decides what adding Grid actually does. It
    // must be the geometry, not the dots: when the fallback above broke, the
    // extents left the group, dot_size became members[0], and adding Grid bound
    // a second copy of a slider the Dots section had already offered.
    expect(grid?.members.map((member) => member.id))
      .toEqual(["grid_width", "dot_size", PHONOSCOPE_SCENE_BLEND_EFFECT]);
  });
});
