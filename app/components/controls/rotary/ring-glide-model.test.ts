import { describe, expect, it } from "vitest";
import { RING_GLIDE_DEG_PER_SEC } from "./constants";
import { glideTowards } from "./ring-glide-model";

/** One frame at 60Hz, the granularity a glide is advanced in. */
const FRAME = 0.016;

describe("glideTowards", () => {
  it("moves at a fixed number of degrees per second of the ring's own arc", () => {
    // 720°/s over a full 270° sweep: a tenth of a second covers a tenth of the
    // range, and the same distance takes the same time whatever the range is.
    expect(glideTowards(0, 1, 270, 100)).toBeCloseTo((RING_GLIDE_DEG_PER_SEC / 270) * 0.1, 6);
    expect(glideTowards(0, 1, 270, 1000)).toBe(1);
  });

  it("makes a long step take longer than a short one", () => {
    // A third of the sweep is 90° — 125ms at 720°/s. The whole 270° is 375ms.
    const oneStopMs = Math.ceil(((1 / 3) * 270 * 1000) / RING_GLIDE_DEG_PER_SEC);
    const wholeSweepMs = Math.ceil((270 * 1000) / RING_GLIDE_DEG_PER_SEC);
    expect(glideTowards(0, 1 / 3, 270, oneStopMs)).toBe(1 / 3);
    expect(glideTowards(0, 1, 270, oneStopMs)).toBeLessThan(1);
    expect(glideTowards(0, 1, 270, wholeSweepMs)).toBe(1);
    // The speed is the same either way: while both are still travelling they
    // have covered the same ground, whatever they are heading for.
    const fiveFrames = FRAME * 1000 * 5;
    expect(glideTowards(0, 1 / 3, 270, fiveFrames)).toBeCloseTo(glideTowards(0, 1, 270, fiveFrames), 9);
    expect(glideTowards(0, 1, 270, FRAME * 1000 * 10)).toBeCloseTo(0.4267, 3);
  });

  it("never overshoots the destination", () => {
    expect(glideTowards(0.9, 1, 270, 10_000)).toBe(1);
    expect(glideTowards(0.1, 0, 270, 10_000)).toBe(0);
  });

  it("runs backwards as readily as forwards", () => {
    expect(glideTowards(1, 0, 270, 100)).toBeCloseTo(1 - (RING_GLIDE_DEG_PER_SEC / 270) * 0.1, 6);
  });

  it("stands still for a zero distance, and for no elapsed time", () => {
    expect(glideTowards(0.4, 0.4, 270, 250)).toBe(0.4);
    expect(glideTowards(0.4, 0.9, 270, 0)).toBe(0.4);
    expect(glideTowards(0.4, 0.9, 270, -50)).toBe(0.4);
  });

  it("keeps the same speed in degrees on a ring shortened to fit its label", () => {
    // A shorter arc means a bigger share of it per frame — the same number of
    // degrees, so the thumb travels at the same visual speed.
    const full = glideTowards(0, 1, 270, 160);
    const short = glideTowards(0, 1, 180, 160);
    expect(full * 270).toBeCloseTo(short * 180, 6);
    expect(short).toBeGreaterThan(full);
  });

  it("survives a degenerate arc without dividing by zero", () => {
    // A ring measured before its arc is known reports a zero span: the guard is
    // against dividing by it, not against arriving at once.
    expect(glideTowards(0, 1, 0, 100)).toBe(1);
    expect(Number.isFinite(glideTowards(0, 1, 0, 0))).toBe(true);
  });
});
