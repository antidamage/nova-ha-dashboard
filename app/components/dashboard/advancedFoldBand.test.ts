import { describe, expect, it } from "vitest";
import {
  ADVANCED_FOLD_BAND_MAX_PX,
  ADVANCED_FOLD_BREAK_PX,
  bandBroken,
  bandDisplacement,
  breakOffset,
  startsOnOwnDragControl,
  wheelAxisDelta,
  wheelDeltaPx,
} from "./advancedFoldBand";

describe("advanced fold band", () => {
  it("follows 28 x (1 - (1 - p/80)^2)", () => {
    expect(ADVANCED_FOLD_BREAK_PX).toBe(80);
    expect(ADVANCED_FOLD_BAND_MAX_PX).toBe(28);
    expect(bandDisplacement(0)).toBe(0);
    expect(bandDisplacement(40)).toBeCloseTo(21, 6);
    expect(bandDisplacement(80)).toBeCloseTo(28, 6);
    // Past the break it moves no further.
    expect(bandDisplacement(200)).toBeCloseTo(28, 6);
    expect(bandDisplacement(60)).toBeLessThan(28);
  });

  it("starts near 1:1 (slope 0.7)", () => {
    expect(bandDisplacement(1)).toBeCloseTo(0.7, 1);
  });

  it("breaks at 80px", () => {
    expect(bandBroken(79.9)).toBe(false);
    expect(bandBroken(80)).toBe(true);
  });

  it("lands the break on the 1:1 position, clamped to the scroll range", () => {
    expect(breakOffset(0, 100, 600)).toBe(100);
    expect(breakOffset(150, 100, 600)).toBe(250);
    expect(breakOffset(150, 100, 200)).toBe(200);
  });

  it("normalises wheel delta modes to pixels", () => {
    expect(wheelDeltaPx(100, 0, 500)).toBe(100);
    expect(wheelDeltaPx(3, 1, 500)).toBe(48);
    expect(wheelDeltaPx(1, 2, 500)).toBe(500);
  });

  it("takes only deltaX in portrait", () => {
    expect(wheelAxisDelta("x", 0, 120)).toBe(0);
    expect(wheelAxisDelta("x", 40, 120)).toBe(40);
    expect(wheelAxisDelta("y", 0, 120)).toBe(120);
    expect(wheelAxisDelta("y", 90, 10)).toBe(0);
  });

  it("recognises controls with their own drag, up to the fold root only", () => {
    document.body.innerHTML = `
      <div data-nova-no-drag-scroll>
        <div id="fold">
          <div role="slider"><span id="knob"></span></div>
          <div role="switch"><span id="ring"></span></div>
          <input id="field" />
          <button id="button"><span id="label"></span></button>
        </div>
      </div>`;
    const fold = document.getElementById("fold");
    expect(startsOnOwnDragControl(document.getElementById("knob"), fold)).toBe(true);
    expect(startsOnOwnDragControl(document.getElementById("ring"), fold)).toBe(true);
    expect(startsOnOwnDragControl(document.getElementById("field"), fold)).toBe(true);
    // The opt-out above the fold's root is not looked at.
    expect(startsOnOwnDragControl(document.getElementById("label"), fold)).toBe(false);
    document.body.innerHTML = "";
  });
});
