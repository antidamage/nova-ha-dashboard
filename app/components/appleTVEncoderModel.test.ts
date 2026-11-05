import { describe, expect, it } from "vitest";
import {
  VOLUME_MAX,
  VOLUME_RING_COLOUR,
  VOLUME_WIDEST,
  clampVolume,
  volumeColour,
  volumeGlow,
  volumeLevelText,
} from "./appleTVEncoderModel";

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

describe("the ring's colour", () => {
  it("is the status orb's colour ring colour, at every level", () => {
    expect(VOLUME_RING_COLOUR).toBe("var(--nova-orb-ring-color, var(--cyber-line))");
    expect(volumeColour()).toBe("var(--nova-orb-ring-color, var(--cyber-line))");
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

  it("reads the theme's line colour, and never a broken channel", () => {
    for (const volume of [1, 25, 50, 75, 100]) {
      const glow = volumeGlow(volume, 133, false);
      expect(glow).not.toContain("NaN");
      expect(glow).toMatch(/^0 0 \d+(\.\d+)?px \d+(\.\d+)?px rgb\(var\(--nova-orb-ring-rgb, var\(--cyber-line-rgb\)\) \/ 0\.\d+\)$/);
    }
  });
});
