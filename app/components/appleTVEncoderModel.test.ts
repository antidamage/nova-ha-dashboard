import { describe, expect, it } from "vitest";
import {
  VOLUME_MAX,
  VOLUME_RING_DEEP,
  VOLUME_RING_MID,
  VOLUME_RING_PALE,
  VOLUME_WIDEST,
  clampVolume,
  hexToRgb,
  mixHex,
  volumeColour,
  volumeGlow,
  volumeLevelText,
  volumeRingPaint,
} from "./appleTVEncoderModel";

const rgb = (hex: string) => `rgb(${hexToRgb(hex).join(", ")})`;

/**
 * The middle stop's angle: the gradient's only moving part. The stops are
 * `... 0deg`, `... <shift>deg`, `... 360deg`, and the `from 0deg` prefix
 * contributes the first angle in the string.
 */
function shiftOf(volume: number) {
  const angles = [...volumeRingPaint(volume, 133).matchAll(/ ([\d.]+)deg/g)].map((match) => Number(match[1]));
  return angles[2];
}

describe("the volume reading", () => {
  it("is a whole 0–100 percent", () => {
    expect(clampVolume(41.4)).toBe(41);
    expect(clampVolume(41.6)).toBe(42);
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(180)).toBe(VOLUME_MAX);
  });

  it("reads as a percent, and never as a bare number", () => {
    expect(volumeLevelText(42)).toBe("42%");
    expect(volumeLevelText(100.4)).toBe("100%");
    expect(VOLUME_WIDEST).toBe("100%");
  });
});

describe("the ring's paint", () => {
  it("is blue-green, in one gradient of three stops", () => {
    const paint = volumeRingPaint(40, 133);
    expect(paint.startsWith("conic-gradient(from 0deg")).toBe(true);
    expect(paint).toContain(`${VOLUME_RING_DEEP} 0deg`);
    expect(paint).toContain(VOLUME_RING_MID);
    expect(paint).toContain(`${VOLUME_RING_PALE} 360deg`);
    expect(paint.match(/conic-gradient/g)).toHaveLength(1);
  });

  it("shifts subtly with the level rather than jumping between two colours", () => {
    expect(shiftOf(0)).toBeLessThan(shiftOf(50));
    expect(shiftOf(50)).toBeLessThan(shiftOf(100));
    // "Subtle": a quarter turn at rest and three quarters at full, never a
    // collapse onto a single stop.
    expect(shiftOf(0)).toBeCloseTo(90, 5);
    expect(shiftOf(100)).toBeCloseTo(270, 5);
  });

  it("never paints outside the range it was given", () => {
    expect(volumeRingPaint(-40, 133)).toBe(volumeRingPaint(0, 133));
    expect(volumeRingPaint(400, 133)).toBe(volumeRingPaint(100, 133));
  });
});

describe("the colour the fill and index take", () => {
  it("runs deep teal, through the blue-green, to pale mint", () => {
    expect(volumeColour(0)).toBe(rgb(VOLUME_RING_DEEP));
    expect(volumeColour(50)).toBe(rgb(VOLUME_RING_MID));
    expect(volumeColour(100)).toBe(rgb(VOLUME_RING_PALE));
  });

  it("moves through its halves instead of jumping at the middle", () => {
    expect(volumeColour(25)).toBe(mixHex(VOLUME_RING_DEEP, VOLUME_RING_MID, 0.5));
    expect(volumeColour(75)).toBe(mixHex(VOLUME_RING_MID, VOLUME_RING_PALE, 0.5));
    expect(volumeColour(25)).not.toBe(volumeColour(50));
  });
});

describe("the ring's glow", () => {
  it("is nothing while muted, whatever the volume", () => {
    expect(volumeGlow(80, 133, true)).toBe("0 0 0 rgba(0, 0, 0, 0)");
  });

  it("is nothing at zero volume, and brighter as the level rises", () => {
    expect(volumeGlow(0, 133, false)).toBe("0 0 0 rgba(0, 0, 0, 0)");
    const quarter = volumeGlow(25, 133, false);
    const full = volumeGlow(100, 133, false);
    expect(quarter).not.toBe(full);
    const blurOf = (glow: string) => Number(glow.split(" ")[2].replace("px", ""));
    expect(blurOf(full)).toBeGreaterThan(blurOf(quarter));
  });
});
