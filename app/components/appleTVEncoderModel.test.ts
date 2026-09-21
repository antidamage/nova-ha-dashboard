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
 * Where the pale band ends and the blue-green begins: the gradient's only
 * moving part, and the one thing about it that answers to the volume.
 */
function midStopOf(volume: number) {
  const percentages = [...volumeRingPaint(volume, 133).matchAll(/ ([\d.]+)%/g)].map((match) => Number(match[1]));
  return percentages[1];
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
  it("runs top to bottom, as every other dial's ring does", () => {
    const paint = volumeRingPaint(40, 133);
    expect(paint.startsWith("linear-gradient(180deg")).toBe(true);
    // Brightest at 12, deepest at 6 — the same direction as the unlock band
    // (rotary-unlock-ring.css), in the blue-green family.
    expect(paint).toContain(`${VOLUME_RING_PALE} 2%`);
    expect(paint).toContain(VOLUME_RING_MID);
    expect(paint).toContain(`${VOLUME_RING_DEEP} 100%)`);
    expect(paint.match(/linear-gradient/g)).toHaveLength(1);
  });

  it("is never a conic or radial sweep", () => {
    for (const volume of [0, 40, 100]) {
      const paint = volumeRingPaint(volume, 133);
      expect(paint).not.toContain("conic-gradient");
      expect(paint).not.toContain("radial-gradient");
      // One angle and one only, which is the 180deg that makes it vertical.
      expect(paint.match(/deg/g)).toHaveLength(1);
    }
  });

  it("shifts subtly with the level rather than jumping between two colours", () => {
    expect(midStopOf(0)).toBeLessThan(midStopOf(50));
    expect(midStopOf(50)).toBeLessThan(midStopOf(100));
    // "Subtle": the boundary moves a quarter of the band between rest and full,
    // and the gradient never collapses onto a single stop.
    expect(midStopOf(0)).toBeCloseTo(40, 5);
    expect(midStopOf(100)).toBeCloseTo(64, 5);
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

  it("carries the level's own blue-green, and never a broken channel", () => {
    // The channels come from volumeColour, which is already `rgb(...)`: feeding
    // it to the hex parser produced `rgba(NaN, …)`, which the browser drops and
    // the dial loses its glow outright — the one shading feature it was missing.
    for (const volume of [1, 25, 50, 75, 100]) {
      const glow = volumeGlow(volume, 133, false);
      expect(glow).not.toContain("NaN");
      expect(glow).toContain(volumeColour(volume).replace("rgb(", "").replace(")", ""));
      expect(glow).toMatch(/^0 0 \d+(\.\d+)?px \d+(\.\d+)?px rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
    }
  });
});
