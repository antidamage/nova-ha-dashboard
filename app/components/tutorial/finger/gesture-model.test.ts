import { describe, expect, it } from "vitest";
import { UNLOCK_MAX_MS, UNLOCK_MIN_MS } from "../../controls/rotary/constants";
import { angleOf, compileGestures, DRAG_PX_PER_SEC, durationOf, pointOnArc, sampleAt, TAP_HOLD_MS } from "./gesture-model";

describe("finger gesture model", () => {
  it("uses screen degrees clockwise from 12", () => {
    const centre = { x: 100, y: 100 };
    const right = pointOnArc(centre, 50, 90);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
    expect(angleOf(centre, { x: 100, y: 50 })).toBeCloseTo(0);
    expect(angleOf(centre, { x: 50, y: 100 })).toBeCloseTo(270);
  });

  it("holds a tap inside the dial's unlock window", () => {
    expect(TAP_HOLD_MS).toBeGreaterThanOrEqual(UNLOCK_MIN_MS);
    expect(TAP_HOLD_MS).toBeLessThanOrEqual(UNLOCK_MAX_MS);
    const samples = compileGestures([{ kind: "tap", at: { x: 10, y: 10 } }], { x: 10, y: 10 });
    const down = samples.find((sample) => sample.edge === "down")!;
    const up = samples.find((sample) => sample.edge === "up")!;
    expect(up.t - down.t).toBe(TAP_HOLD_MS);
  });

  it("drags slowly, about 60px a second", () => {
    const samples = compileGestures([{ kind: "drag", path: [{ x: 0, y: 0 }, { x: 120, y: 0 }] }], { x: 0, y: 0 });
    const down = samples.find((sample) => sample.edge === "down")!;
    const up = samples.find((sample) => sample.edge === "up")!;
    expect(up.t - down.t).toBeGreaterThanOrEqual((120 / DRAG_PX_PER_SEC) * 1000);
    expect(up.t - down.t).toBeLessThan((120 / DRAG_PX_PER_SEC) * 1000 + 100);
  });

  it("presses once per gesture and releases every press", () => {
    const samples = compileGestures([
      { kind: "tap", at: { x: 10, y: 10 } },
      { kind: "arc", centre: { x: 100, y: 100 }, radius: 50, fromDeg: 0, toDeg: 90 },
      { kind: "rest", ms: 500 },
    ], { x: 0, y: 0 });
    expect(samples.filter((sample) => sample.edge === "down")).toHaveLength(2);
    expect(samples.filter((sample) => sample.edge === "up")).toHaveLength(2);
    for (let index = 1; index < samples.length; index += 1) expect(samples[index].t).toBeGreaterThanOrEqual(samples[index - 1].t);
    expect(samples[samples.length - 1].pressed).toBe(false);
  });

  it("follows the arc it was given", () => {
    const centre = { x: 100, y: 100 };
    const samples = compileGestures([{ kind: "arc", centre, radius: 40, fromDeg: 0, toDeg: 180 }], { x: 100, y: 60 });
    for (const sample of samples.filter((candidate) => candidate.pressed)) {
      expect(Math.hypot(sample.x - centre.x, sample.y - centre.y)).toBeGreaterThan(38);
    }
  });

  it("finds the sample in force at a time", () => {
    const samples = compileGestures([{ kind: "rest", ms: 100 }, { kind: "tap", at: { x: 50, y: 0 } }], { x: 0, y: 0 });
    expect(sampleAt(samples, -1)).toBe(-1);
    expect(sampleAt(samples, 0)).toBe(0);
    expect(sampleAt(samples, durationOf(samples) + 10)).toBe(samples.length - 1);
  });
});
