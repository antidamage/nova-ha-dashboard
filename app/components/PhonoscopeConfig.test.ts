import { describe, expect, it } from "vitest";
import {
  driverLabel,
  effectCatalogue,
  effectNeedsPulseDriver,
  laneLabel,
  ordinal,
  type ModuleSetting,
} from "./phonoscope/effectCatalogue";
import { phonoscopeDriver, PHONOSCOPE_THEME_CHANGE_EFFECT } from "../../lib/phonoscope-drivers";
import { themeGradient } from "./phonoscope/ColorThemeLibrary";
import { unusedDriverType } from "./phonoscope/SettingsGroupLibrary";

const settings: ModuleSetting[] = [
  {
    id: "intensity", label: "Ripple intensity", control: "slider",
    min: 0, max: 2, step: 0.05, default: 1, section: "motion", updateMode: "smooth",
  },
  {
    id: "complexity", label: "Visual complexity", control: "slider",
    min: 0.2, max: 1, step: 0.05, default: 1, section: "motion", updateMode: "structural",
  },
];

describe("effect catalogue", () => {
  const catalogue = effectCatalogue(settings);

  it("offers the picture-level effects that no module declares", () => {
    const ids = catalogue.map((effect) => effect.id);
    expect(ids).toContain("__glowBlur");
    expect(ids).toContain("__glowOpacity");
    expect(ids).toContain("__glowBlend");
    expect(ids).toContain("__messageScale");
    expect(ids).toContain("__hueOffset");
    expect(ids).toContain(PHONOSCOPE_THEME_CHANGE_EFFECT);
  });

  it("offers the module's driveable settings and hides structural ones", () => {
    const ids = catalogue.map((effect) => effect.id);
    expect(ids).toContain("intensity");
    // Complexity rebuilds the scene, so it is edited on the settings group
    // rather than bound to a lane.
    expect(ids).not.toContain("complexity");
  });

  it("groups module settings under their declared section, title-cased", () => {
    expect(catalogue.find((effect) => effect.id === "intensity")?.section).toBe("Motion");
    expect(catalogue.find((effect) => effect.id === "__glowBlur")?.section).toBe("Picture");
  });
});

describe("lane labels", () => {
  it("names a plain pulse by its driver", () => {
    expect(driverLabel(phonoscopeDriver({ type: "beat" }))).toBe("Beat");
    expect(driverLabel(phonoscopeDriver({ type: "downbeat" }))).toBe("Downbeat");
  });

  it("names a counted pulse by its cycle", () => {
    expect(driverLabel(phonoscopeDriver({ type: "beat", every: 2 }))).toBe("Every 2nd beat");
    expect(driverLabel(phonoscopeDriver({ type: "downbeat", every: 4 })))
      .toBe("Every 4th downbeat");
  });

  it("names an offset cycle by where it starts", () => {
    expect(driverLabel(phonoscopeDriver({ type: "downbeat", every: 4, offset: 1 })))
      .toBe("Every 4th downbeat, from the 2nd");
  });

  it("names a timer by its interval", () => {
    expect(driverLabel(phonoscopeDriver({ type: "timer", intervalSeconds: 8 })))
      .toBe("Timer · 8.0s");
  });

  it("names a random driver by what it re-samples on", () => {
    expect(driverLabel(phonoscopeDriver({ type: "random", cadence: "downbeat" })))
      .toBe("Random on downbeat");
  });

  it("appends the added drivers", () => {
    expect(laneLabel(
      phonoscopeDriver({ type: "downbeat", every: 4 }),
      [phonoscopeDriver({ type: "bass" })],
    )).toBe("Every 4th downbeat + Bass");
  });
});

describe("unusedDriverType", () => {
  it("gives a new lane a driver the group is not already running", () => {
    const lane = (type: string) => ({
      id: type, driver: phonoscopeDriver({ type: type as never }), modifiers: [], bindings: [],
    });
    expect(unusedDriverType([])).toBe("beat");
    expect(unusedDriverType([lane("beat")])).toBe("downbeat");
    expect(unusedDriverType([lane("beat"), lane("downbeat")])).toBe("bass");
  });

  it("falls back once every driver is in use", () => {
    const all = ["beat", "downbeat", "bass", "mid", "treble", "energy", "song", "timer", "random"]
      .map((type) => ({
        id: type, driver: phonoscopeDriver({ type: type as never }), modifiers: [], bindings: [],
      }));
    expect(unusedDriverType(all)).toBe("beat");
  });
});

describe("ordinal", () => {
  it("handles the teens and the exceptions", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});

describe("effectNeedsPulseDriver", () => {
  it("flags the theme change, which has no meaning under a level driver", () => {
    expect(effectNeedsPulseDriver(PHONOSCOPE_THEME_CHANGE_EFFECT)).toBe(true);
    expect(effectNeedsPulseDriver("__glowOpacity")).toBe(false);
  });
});

describe("themeGradient", () => {
  it("reads a theme's background, dot and glow", () => {
    const gradient = themeGradient({
      backgroundPrimary: { rgb: [0, 0, 0], intensity: 100, opacity: 100 },
      dotPrimary: { rgb: [255, 0, 0], intensity: 100, opacity: 100 },
      glowPrimary: { rgb: [0, 255, 0], intensity: 50, opacity: 80 },
    });
    expect(gradient).toContain("rgb(0 0 0 / 1)");
    expect(gradient).toContain("rgb(255 0 0 / 1)");
    // Intensity scales the channels; opacity rides the alpha.
    expect(gradient).toContain("rgb(0 128 0 / 0.8)");
  });

  it("falls back when a slot is missing", () => {
    expect(themeGradient({})).toContain("#000");
  });
});
