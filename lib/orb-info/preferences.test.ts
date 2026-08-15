import { describe, expect, it } from "vitest";
import { orbModuleById } from "./catalogue";
import { DEFAULT_ORB_DISPLAY } from "./format";
import {
  normalizeOrbDisplay,
  normalizedOrbInfoPreferences,
  resolveOrbDisplay,
  resolveOrbModuleId,
} from "./preferences";

describe("resolveOrbModuleId", () => {
  it("defaults to the gym counter so existing installs are unchanged", () => {
    expect(resolveOrbModuleId(undefined)).toBe("gym");
    expect(resolveOrbModuleId({})).toBe("gym");
  });

  it("accepts none as a real selection rather than falling back", () => {
    expect(resolveOrbModuleId({ moduleId: "none" })).toBe("none");
  });

  it("ignores a module id that no longer exists", () => {
    expect(resolveOrbModuleId({ moduleId: "retired-module" })).toBe("gym");
  });
});

describe("resolveOrbDisplay", () => {
  it("returns the module default when nothing is saved", () => {
    expect(resolveOrbDisplay(undefined, "gym")).toEqual(orbModuleById("gym").defaultDisplay);
  });

  it("overlays saved edits onto the module default", () => {
    const display = resolveOrbDisplay({ modules: { gym: { display: { decimals: 2 } } } }, "gym");
    expect(display.decimals).toBe(2);
    // Untouched fields keep the module's default, not the global default.
    expect(display.format).toBe("duration");
    expect(display.rounding).toBe("floor");
  });

  it("falls back to the module default format when a saved format is unsupported", () => {
    const display = resolveOrbDisplay({ modules: { gym: { display: { format: "clock" } } } }, "gym");
    expect(display.format).toBe("duration");
  });
});

describe("normalizeOrbDisplay", () => {
  it("clamps decimals into range", () => {
    expect(normalizeOrbDisplay({ decimals: 9 }).decimals).toBe(3);
    expect(normalizeOrbDisplay({ decimals: -4 }).decimals).toBe(0);
  });

  it("rejects a garbage format instead of rendering nothing", () => {
    expect(normalizeOrbDisplay({ format: "sideways" }).format).toBe(DEFAULT_ORB_DISPLAY.format);
  });

  it("rejects a zero percent basis that would divide the readout into nonsense", () => {
    expect(normalizeOrbDisplay({ percentOf: { kind: "fixed", value: 0 } }).percentOf)
      .toEqual(DEFAULT_ORB_DISPLAY.percentOf);
    expect(normalizeOrbDisplay({ percentOf: { kind: "fixed", value: 800 } }).percentOf)
      .toEqual({ kind: "fixed", value: 800 });
  });

  it("truncates over-long affixes rather than letting them overflow the orb", () => {
    expect(normalizeOrbDisplay({ suffix: "aaaaaaaaaaaaaaaaaaaa" }).suffix).toHaveLength(8);
  });
});

describe("normalizedOrbInfoPreferences", () => {
  it("drops config for modules that no longer exist", () => {
    const result = normalizedOrbInfoPreferences({
      moduleId: "gym",
      modules: { gym: { display: { decimals: 1 } }, "retired-module": { display: { decimals: 3 } } },
    });
    expect(Object.keys(result.modules ?? {})).toEqual(["gym"]);
  });

  it("keeps every surviving module's config", () => {
    const result = normalizedOrbInfoPreferences({
      moduleId: "clock",
      modules: {
        gym: { display: { decimals: 1 } },
        clock: { display: { clock12Hour: true } },
      },
    });
    expect(result.modules?.gym?.display?.decimals).toBe(1);
    expect(result.modules?.clock?.display?.clock12Hour).toBe(true);
  });
});
