import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESET_ICON_ID, PRESET_ICON_CATALOG } from "../../../lib/apple-tv/preset-icons";
import { PresetIconMark, presetIconComponent } from "./appleTVPresetIcon";

/** The class Lucide gives a component, which says which one was drawn. */
function drawnClasses(icon: string | null) {
  const { container } = render(<PresetIconMark icon={icon} />);
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

afterEach(cleanup);

describe("the preset icon registry", () => {
  it("draws every catalogue id its own icon, not the note behind it", () => {
    // The assertion names each id's own component, so a catalogue entry that
    // was never joined to a Lucide export fails here instead of rendering a
    // note where a flame should be — which is how `dumbbell` was caught.
    for (const entry of PRESET_ICON_CATALOG) {
      const classes = drawnClasses(entry.id);
      expect(classes, entry.id).toContain("lucide-");
      expect(classes, entry.id).toContain(`lucide-${entry.id}`);
    }
  });

  it("draws the note for a preset that has chosen no icon", () => {
    expect(drawnClasses(null)).toContain(`lucide-${DEFAULT_PRESET_ICON_ID}`);
    expect(presetIconComponent(null)).toBe(presetIconComponent(DEFAULT_PRESET_ICON_ID));
  });

  it("draws the note rather than nothing for an icon this build does not ship", () => {
    expect(drawnClasses("saxophone")).toContain(`lucide-${DEFAULT_PRESET_ICON_ID}`);
  });
});
