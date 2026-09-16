import { describe, expect, it } from "vitest";
import {
  ADVANCED_FOLD_DRAG_BAND_MAX_PX,
  ADVANCED_FOLD_DRAG_BREAK_PX,
  ADVANCED_FOLD_TOUCH_AXIS_PX,
  ADVANCED_FOLD_WHEEL_BAND_MAX_PX,
  ADVANCED_FOLD_WHEEL_BREAK_PX,
  ADVANCED_FOLD_WHEEL_FACTOR,
  ADVANCED_FOLD_WHEEL_IDLE_MS,
  bandBroken,
  bandDisplacement,
  ADVANCED_FOLD_INERTIA_FRICTION,
  ADVANCED_FOLD_INERTIA_STOP,
  breakOffset,
  flickVelocity,
  inertiaStep,
  startsInInnerScroller,
  startsOnOwnDragControl,
  wheelAxisDelta,
  wheelDeltaPx,
} from "./advancedFoldBand";

describe("advanced fold band", () => {
  it("drag follows 14 x (1 - (1 - p/160)^2)", () => {
    expect(ADVANCED_FOLD_DRAG_BREAK_PX).toBe(160);
    expect(ADVANCED_FOLD_DRAG_BAND_MAX_PX).toBe(14);
    expect(bandDisplacement(0, "drag")).toBe(0);
    expect(bandDisplacement(80, "drag")).toBeCloseTo(10.5, 6);
    expect(bandDisplacement(160, "drag")).toBeCloseTo(14, 6);
    expect(bandDisplacement(400, "drag")).toBeCloseTo(14, 6);
    // Slope 2 x 14 / 160 = 0.175 at rest.
    expect(bandDisplacement(1, "drag")).toBeCloseTo(0.175, 2);
  });

  it("wheel keeps 28 x (1 - (1 - p/80)^2), a quarter factor and a 400ms decay", () => {
    expect(ADVANCED_FOLD_WHEEL_BREAK_PX).toBe(80);
    expect(ADVANCED_FOLD_WHEEL_BAND_MAX_PX).toBe(28);
    expect(ADVANCED_FOLD_WHEEL_FACTOR).toBe(0.25);
    expect(ADVANCED_FOLD_WHEEL_IDLE_MS).toBe(400);
    expect(bandDisplacement(40, "wheel")).toBeCloseTo(21, 6);
    expect(bandDisplacement(80, "wheel")).toBeCloseTo(28, 6);
    expect(bandDisplacement(200, "wheel")).toBeCloseTo(28, 6);
    expect(bandDisplacement(1, "wheel")).toBeCloseTo(0.7, 1);
  });

  it("breaks a drag at 160px and the wheel at 80px", () => {
    expect(bandBroken(159.9, "drag")).toBe(false);
    expect(bandBroken(160, "drag")).toBe(true);
    expect(bandBroken(79.9, "wheel")).toBe(false);
    expect(bandBroken(80, "wheel")).toBe(true);
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

  it("has a tap threshold before a drag drives", () => {
    expect(ADVANCED_FOLD_TOUCH_AXIS_PX).toBe(8);
  });

  it("recognises controls with their own press or drag, up to the fold root only", () => {
    document.body.innerHTML = `
      <div data-nova-no-drag-scroll>
        <div id="fold">
          <h3 id="heading">Lounge</h3>
          <div role="slider"><span id="knob"></span></div>
          <div role="switch"><span id="ring"></span></div>
          <input id="field" />
          <button id="button"><span id="label"></span></button>
          <div role="button"><span id="rolebutton"></span></div>
          <a href="#x"><span id="link"></span></a>
          <p><span id="text">Whitespace</span></p>
        </div>
      </div>`;
    const fold = document.getElementById("fold");
    const on = (id: string) => startsOnOwnDragControl(document.getElementById(id), fold);
    expect(on("knob")).toBe(true);
    expect(on("ring")).toBe(true);
    expect(on("field")).toBe(true);
    expect(on("label")).toBe(true);
    expect(on("rolebutton")).toBe(true);
    expect(on("link")).toBe(true);
    // Headings, text and whitespace start a drag; the opt-out above the root is not looked at.
    expect(on("heading")).toBe(false);
    expect(on("text")).toBe(false);
    expect(on("fold")).toBe(false);
    document.body.innerHTML = "";
  });

  it("gives an inner scroller the drag only while it has room in the drag's direction", () => {
    document.body.innerHTML = `
      <div id="fold">
        <div id="list" style="overflow-y:auto"><span id="row"></span></div>
        <div id="cells" style="overflow-x:auto"><span id="cell"></span></div>
      </div>`;
    const fold = document.getElementById("fold");
    const list = document.getElementById("list")!;
    const row = document.getElementById("row");
    let top = 0;
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top });
    // At its top: room toward Advanced only.
    expect(startsInInnerScroller(row, fold, "y", 1)).toBe(true);
    expect(startsInInnerScroller(row, fold, "y", -1)).toBe(false);
    expect(startsInInnerScroller(row, fold, "y")).toBe(true);
    // At its end: room back only.
    top = 300;
    expect(startsInInnerScroller(row, fold, "y", 1)).toBe(false);
    expect(startsInInnerScroller(row, fold, "y", -1)).toBe(true);
    // A sideways scroller is not along a landscape fold's axis.
    const cells = document.getElementById("cells")!;
    Object.defineProperty(cells, "scrollWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(cells, "clientWidth", { configurable: true, get: () => 100 });
    expect(startsInInnerScroller(document.getElementById("cell"), fold, "y", 1)).toBe(false);
    expect(startsInInnerScroller(document.getElementById("cell"), fold, "x", 1)).toBe(true);
    document.body.innerHTML = "";
  });
  it("decays a flick at 0.95 per 60fps frame and stops under 0.05 px/frame", () => {
    expect(ADVANCED_FOLD_INERTIA_FRICTION).toBe(0.95);
    expect(ADVANCED_FOLD_INERTIA_STOP).toBe(0.05);
    const one = inertiaStep(20);
    expect(one.distance).toBeCloseTo(20, 6);
    expect(one.velocity).toBeCloseTo(19, 6);
    // Two frames' time in one step decays twice.
    const two = inertiaStep(20, 2000 / 60);
    expect(two.distance).toBeCloseTo(40, 6);
    expect(two.velocity).toBeCloseTo(20 * 0.95 * 0.95, 6);
    expect(inertiaStep(-10).velocity).toBeCloseTo(-9.5, 6);
    expect(inertiaStep(0.052).velocity).toBe(0);
    // A 20 px/frame flick comes to rest, having travelled about v / (1 - 0.95).
    let v = 20;
    let travelled = 0;
    let frames = 0;
    while (v !== 0 && frames < 1000) {
      const step = inertiaStep(v);
      travelled += step.distance;
      v = step.velocity;
      frames += 1;
    }
    expect(frames).toBeLessThan(200);
    expect(travelled).toBeGreaterThan(380);
    expect(travelled).toBeLessThan(400);
  });

  it("measures release velocity over the last 100ms only", () => {
    expect(flickVelocity([])).toBe(0);
    expect(flickVelocity([{ time: 0, pos: 0 }])).toBe(0);
    // 150px in 100ms is 25 px per 60fps frame; the slow start is outside the window.
    const samples = [
      { time: 0, pos: 0 },
      { time: 400, pos: 10 },
      { time: 500, pos: 160 },
      { time: 600, pos: 310 },
    ];
    expect(flickVelocity(samples)).toBeCloseTo(25, 6);
    expect(flickVelocity([{ time: 0, pos: 100 }, { time: 50, pos: 0 }])).toBeCloseTo(-100 / 3, 6);
  });
});
