import { describe, expect, it } from "vitest";
import {
  normalizeOrbModule,
  orbResolvedSettingId,
  resolveOrbModuleSettings,
} from "../../lib/orb-modules";
import { TECH_MODULE } from "../../lib/orb-modules/tech.data";
import { orbAutoOptionResolver } from "./orbModules";

// orbAutoOptionResolver is the only link between the device's knob skin and a
// module's `auto` stop. Nothing else exercised it: the choice-model tests inject
// hand-rolled resolvers, and the config's e2e spec drove only the pinned stops.
// That gap let a case-sensitive stop lookup ship, which made the new default
// (Auto) paint the pale knob on every theme - so it is pinned here, against the
// real module and the real resolver rather than a stand-in.
describe("orbAutoOptionResolver", () => {
  const knobTheme = TECH_MODULE.settings![0];

  it("resolves a title-case stop list from the lower-case treatment", () => {
    // The stops are labels the owner reads ("Dark"); the treatment is a
    // lower-case token. These are deliberately not the same casing.
    expect(knobTheme.options).toEqual(["Light", "Auto", "Dark"]);
    expect(orbAutoOptionResolver("dark")(knobTheme)).toBe(2);
    expect(orbAutoOptionResolver("light")(knobTheme)).toBe(0);
  });

  it("leaves a module naming neither treatment unanswered", () => {
    const flavours = normalizeOrbModule({
      id: "flavours",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
      settings: [{ id: "f", label: "F", min: 0, max: 2, step: 1, default: 1, options: ["Low", "Auto", "High"] }],
    });
    expect(orbAutoOptionResolver("dark")(flavours!.settings![0])).toBeUndefined();
  });

  it("drives the Tech module's gates to the device's treatment while on Auto", () => {
    // The end-to-end claim of the feature: left on its default Auto stop, the
    // orb draws the stack matching the device's knob skin - and specifically
    // not the first concrete stop, which is where a missed lookup landed.
    const resolvedId = orbResolvedSettingId("knobTheme");
    const onDark = resolveOrbModuleSettings(TECH_MODULE, {}, orbAutoOptionResolver("dark"));
    const onLight = resolveOrbModuleSettings(TECH_MODULE, {}, orbAutoOptionResolver("light"));
    expect(onDark[resolvedId]).toBe(0);
    expect(onLight[resolvedId]).toBe(1);
    expect(onDark.knobTheme).toBe(1); // still the Auto stop for the control
  });
});
