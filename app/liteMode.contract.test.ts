import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract tripwire for the lite-mode plumbing (SPEC.md "Experience Modes",
// docs/lite-mode.md). The pre-paint seed lives in an inline <head> script and
// the kill-switch lives in plain CSS — neither has a runtime handle in jsdom,
// so these assertions grep the sources. If one of these fails, the per-device
// lite pathway is broken for every lite device: fix the plumbing (or update
// SPEC.md §"Experience Modes" and this test together if the contract itself
// is intentionally changing).

const appDir = __dirname;
const globalsCss = readFileSync(join(appDir, "globals.css"), "utf8");
const layoutSource = readFileSync(join(appDir, "layout.tsx"), "utf8");

describe("lite mode contract", () => {
  it("globals.css keeps the html[data-nova-lite] kill-switch that neutralises CSS effects", () => {
    const killSwitch = globalsCss.match(/html\[data-nova-lite\]\s*\*[^{]*\{[^}]*\}/);
    expect(killSwitch, "missing html[data-nova-lite] * { … } blanket rule").not.toBeNull();
    expect(killSwitch![0]).toContain("animation-duration");
    expect(killSwitch![0]).toContain("transition-duration");
    expect(killSwitch![0]).toContain("backdrop-filter: none");
  });

  it("globals.css hides the status orb on lite devices before hydration", () => {
    expect(globalsCss).toMatch(/html\[data-nova-lite\]\s+\.nova-avatar-host\s*\{[^}]*display:\s*none/);
  });

  it("globals.css forces instant scroll on lite devices (the blanket kill-switch does not cover scroll-behavior)", () => {
    // scroll-behavior: smooth is opt-out for lite and reduced-motion — the
    // wheel-momentum engine self-gates, but the CSS jump-smoothing needs an
    // explicit override since the html[data-nova-lite] * rule never touches it.
    expect(globalsCss).toMatch(/html\[data-nova-lite\]\s*\{[^}]*scroll-behavior:\s*auto/);
    expect(globalsCss).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]{0,80}scroll-behavior:\s*auto/);
  });

  it("layout.tsx head bootstrap seeds data-nova-lite from the experience-mode key pre-paint", () => {
    expect(layoutSource).toContain('localStorage.getItem("nova.dashboard.experienceMode.v1")');
    expect(layoutSource).toContain('toggleAttribute("data-nova-lite"');
  });

  it("layout.tsx mounts the first-run experience chooser", () => {
    expect(layoutSource).toContain("<ExperienceModeModal />");
  });
});
