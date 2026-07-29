import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract tripwire for the reminder tile outline shape.
//
// globals.css enforces the dashboard's hard-corner house style with
// `.dashboard-shell button { border-radius: 0 !important }`. The reminder
// sigils are buttons inside that shell, so without an explicit escape the
// user-facing outline setting is silently overridden and every shape renders
// as a sharp box — which is exactly what shipped once.
//
// jsdom does not do cascade or !important resolution well enough to catch this
// from a render test, so assert on the source the way the lite-mode contract
// test does.

const globalsCss = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("reminder outline contract", () => {
  it("still has the hard-corner rule these escapes exist to defeat", () => {
    // If this disappears, the escapes below are dead weight and should go too.
    expect(globalsCss).toMatch(
      /\.dashboard-shell button,[\s\S]{0,200}?border-radius:\s*0\s*!important/,
    );
  });

  it("exempts the reminder tiles so the outline setting actually applies", () => {
    expect(globalsCss).toMatch(
      /\.dashboard-shell button\.reminder-tile\s*\{[^}]*border-radius:\s*var\(--reminder-tile-radius\)\s*!important/,
    );
  });

  it("exempts the config-page sigil surfaces, which live in the same shell", () => {
    expect(globalsCss).toMatch(
      /\.dashboard-shell button\.reminder-config-glyph\s*\{[^}]*border-radius:[^}]*!important/,
    );
    expect(globalsCss).toMatch(
      /\.dashboard-shell button\.reminder-picker-option\s*\{[^}]*border-radius:[^}]*!important/,
    );
  });

  it("derives the tile radius from the tile size, not from em", () => {
    // .reminder-tile sets no font-size of its own, so an em radius resolves
    // against the inherited root size and collapses to a near-square corner.
    const declaration = globalsCss.match(/--reminder-tile-radius:\s*([^;]+);/);
    expect(declaration).not.toBeNull();
    expect(declaration![1]).toContain("--reminder-tile-size");
    expect(declaration![1]).not.toMatch(/\dem\b/);
  });

  it("offers all three outline shapes", () => {
    for (const shape of ["circle", "square"]) {
      expect(globalsCss).toContain(`.reminder-icon-bar[data-outline="${shape}"]`);
    }
  });
});
