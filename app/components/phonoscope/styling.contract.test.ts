import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The colour theme editor once used a `theme-widget-grid` class that did not
// exist in globals.css. Tailwind's `grid` then fell back to one column and
// listed every palette slot down the page. A missing class name is invisible at
// runtime, so it is checked here instead.
const componentDir = __dirname;
const css = readFileSync(join(componentDir, "..", "..", "globals.css"), "utf8");
const library = readFileSync(join(componentDir, "ColorThemeLibrary.tsx"), "utf8");
const centreImages = readFileSync(join(componentDir, "CentreImageLibrary.tsx"), "utf8");

describe("colour theme library styling", () => {
  it("lays palette slots out in the shared wrapping row", () => {
    expect(library).toContain("theme-widget-flow");
    expect(css).toMatch(/\.theme-widget-flow\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("does not reference a class globals.css never defines", () => {
    // Both files, because the same failure recurred in the image library: a
    // selection ring built from Tailwind `ring-*` utilities rendered nothing at
    // all, and an invisible highlight looks exactly like no highlight.
    const custom = [library, centreImages]
      .flatMap((source) => [...source.matchAll(/className=["`]([^"`]*)[\"`]/g)])
      .flatMap((match) => match[1].split(/\s+/))
      // Only project classes look like this; Tailwind utilities are excluded by
      // requiring a hyphenated prefix that globals.css actually owns.
      .filter((name) => /^(theme|cyber|config|icon|centre)-/.test(name));
    for (const name of new Set(custom)) {
      expect(css.includes(`.${name}`), `globals.css has no .${name}`).toBe(true);
    }
  });
});

describe("centre image library styling", () => {
  it("marks the assigned image with a defined highlight ring", () => {
    expect(centreImages).toContain("centre-image-tile-selected");
    // The ring must actually draw something in the theme's highlight colour.
    expect(css).toMatch(
      /\.centre-image-tile-selected\s*\{[^}]*box-shadow:[^;]*--cyber-highlight/);
  });

  it("does not reuse Tailwind ring utilities, which render nothing on this surface", () => {
    expect(centreImages).not.toMatch(/\bring-(2|offset)/);
  });
});
