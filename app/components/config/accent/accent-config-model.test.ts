import { describe, expect, it } from "vitest";
import { DEFAULT_DARK_THEME } from "../../theme/accent/defaults";
import type { ThemeColorValue } from "../../theme/accent/types";
import { extractSection, mergeSection } from "../../themeSections";
import { THEME_SLOTS, themeColorForSlot } from "./accent-config-model";

// The embossed unlock ring's colour: a slot of its own in Theme Colours, right
// beside the LED Lights picker it used to follow (Adeline, 2026-09-21;
// specs/color-encoder.md, "The unlock ring's colour").

const RING: ThemeColorValue = { cursor: { x: 0.5, y: 0.1 }, intensity: 70, rgb: [1, 2, 3] };

describe("the Unlock Ring colour slot", () => {
  it("sits in Theme Colours directly beside the LED Lights picker", () => {
    const slots = THEME_SLOTS.map((choice) => choice.slot);
    expect(slots.indexOf("unlockRingColor")).toBe(slots.indexOf("ledColor") + 1);
  });

  it("reads the theme's own field, not the LED colour", () => {
    const theme = { ...DEFAULT_DARK_THEME, unlockRingColor: RING };
    expect(themeColorForSlot(theme, "unlockRingColor")).toEqual(RING);
    expect(themeColorForSlot(theme, "ledColor")).toEqual(DEFAULT_DARK_THEME.ledColor);
  });

  it("travels with the theme colours section", () => {
    const theme = { ...DEFAULT_DARK_THEME, unlockRingColor: RING };
    const payload = extractSection(theme, "themeColours");
    expect(payload.unlockRingColor).toEqual(RING);

    const merged = mergeSection(DEFAULT_DARK_THEME, "themeColours", payload);
    expect(merged.unlockRingColor).toEqual(RING);
    // The LED colour came along unchanged rather than being overwritten by it.
    expect(merged.ledColor).toEqual(DEFAULT_DARK_THEME.ledColor);
  });
});
