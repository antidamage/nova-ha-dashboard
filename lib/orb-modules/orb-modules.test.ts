import { describe, expect, it } from "vitest";
import {
  BUILTIN_ORB_MODULES,
  BUILTIN_ORB_MODULE_MAP,
  FALLBACK_ORB_MODULE_ID,
  hexToRgb,
  isValidOrbModuleId,
  normalizeOrbColorRef,
  normalizeOrbModule,
  ORB_MODULE_FORMAT_VERSION,
  resolveOrbColor,
  resolveOrbModule,
  type OrbPalette,
} from "../orb-modules";

// A simple palette where every slot is distinct, for resolution assertions.
const PALETTE: OrbPalette = {
  gradientCenter: { rgb: [10, 20, 30], alpha: 1 },
  gradientOuter: { rgb: [40, 50, 60], alpha: 1 },
  gradientAlert: { rgb: [255, 0, 0], alpha: 1 },
  line1: { rgb: [80, 130, 255], alpha: 0.5 },
  line2: { rgb: [180, 95, 240], alpha: 1 },
  line3: { rgb: [60, 220, 240], alpha: 1 },
  gymNumber: { rgb: [255, 255, 255], alpha: 0.5 },
  innerShadow: { rgb: [0, 0, 0], alpha: 0.5 },
};

describe("orb module ids", () => {
  it("accepts url/file-safe slugs", () => {
    expect(isValidOrbModuleId("classic")).toBe(true);
    expect(isValidOrbModuleId("my-orb_2")).toBe(true);
  });

  it("rejects unsafe or empty ids", () => {
    expect(isValidOrbModuleId("")).toBe(false);
    expect(isValidOrbModuleId("../../etc")).toBe(false);
    expect(isValidOrbModuleId("has space")).toBe(false);
    expect(isValidOrbModuleId(42)).toBe(false);
    expect(isValidOrbModuleId("-leading-dash")).toBe(false);
  });
});

describe("normalizeOrbColorRef", () => {
  it("keeps theme refs and drops redundant hex", () => {
    expect(normalizeOrbColorRef({ theme: "line1", hex: "#fff" })).toEqual({ theme: "line1" });
  });

  it("lowercases valid hex and falls back to white for junk", () => {
    expect(normalizeOrbColorRef({ hex: "#A1B2C3" })).toEqual({ hex: "#a1b2c3" });
    expect(normalizeOrbColorRef({ hex: "red" })).toEqual({ hex: "#ffffff" });
    expect(normalizeOrbColorRef(null)).toEqual({ hex: "#ffffff" });
  });

  it("clamps alpha and keeps alertTheme only when valid", () => {
    expect(normalizeOrbColorRef({ theme: "line1", alpha: 7 })).toEqual({ theme: "line1", alpha: 1 });
    expect(normalizeOrbColorRef({ theme: "line1", alertTheme: "gradientAlert" }))
      .toEqual({ theme: "line1", alertTheme: "gradientAlert" });
    expect(normalizeOrbColorRef({ theme: "line1", alertTheme: "nope" })).toEqual({ theme: "line1" });
  });
});

describe("resolveOrbColor", () => {
  it("resolves theme slots with their palette alpha", () => {
    expect(resolveOrbColor({ theme: "line1" }, PALETTE, 0)).toEqual({ rgb: [80, 130, 255], alpha: 0.5 });
  });

  it("multiplies the ref alpha on top of the palette alpha", () => {
    expect(resolveOrbColor({ theme: "line1", alpha: 0.5 }, PALETTE, 0).alpha).toBeCloseTo(0.25);
  });

  it("parses hex refs at full alpha", () => {
    expect(resolveOrbColor({ hex: "#102030" }, PALETTE, 0)).toEqual({ rgb: [16, 32, 48], alpha: 1 });
  });

  it("mixes toward the alert slot by the pulse amount", () => {
    const resolved = resolveOrbColor(
      { theme: "gradientOuter", alertTheme: "gradientAlert" },
      PALETTE,
      0.5,
    );
    // halfway between [40,50,60] and [255,0,0]
    expect(resolved.rgb).toEqual([148, 25, 30]);
  });

  it("ignores alertTheme when the pulse is zero", () => {
    const resolved = resolveOrbColor(
      { theme: "gradientOuter", alertTheme: "gradientAlert" },
      PALETTE,
      0,
    );
    expect(resolved.rgb).toEqual([40, 50, 60]);
  });
});

describe("hexToRgb", () => {
  it("expands #rgb shorthand", () => {
    expect(hexToRgb("#f0a")).toEqual([255, 0, 170]);
  });

  it("parses #rrggbb", () => {
    expect(hexToRgb("#80ff00")).toEqual([128, 255, 0]);
  });

  it("yields white for invalid input", () => {
    expect(hexToRgb("nope")).toEqual([255, 255, 255]);
  });
});

describe("normalizeOrbModule", () => {
  it("rejects documents without a valid id or layers", () => {
    expect(normalizeOrbModule(null)).toBeNull();
    expect(normalizeOrbModule({ id: "x", layers: [] })).toBeNull();
    expect(normalizeOrbModule({ id: "bad id!", layers: [{ type: "ring", radius: 1, width: 0.1 }] })).toBeNull();
  });

  it("rejects documents from a newer format version", () => {
    expect(
      normalizeOrbModule({
        formatVersion: ORB_MODULE_FORMAT_VERSION + 1,
        id: "future",
        layers: [{ type: "ring", radius: 1, width: 0.1 }],
      }),
    ).toBeNull();
  });

  it("survives a module made only of unknown layers by rejecting it", () => {
    expect(normalizeOrbModule({ id: "weird", layers: [{ type: "hologram" }] })).toBeNull();
  });

  it("defaults name to the id and trims metadata", () => {
    const module = normalizeOrbModule({
      id: "minimal",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
    });
    expect(module).toMatchObject({
      id: "minimal",
      name: "minimal",
      description: "",
      formatVersion: ORB_MODULE_FORMAT_VERSION,
      alertPulsePeriod: 1.2,
    });
  });

  it("round-trips every built-in unchanged", () => {
    for (const builtin of BUILTIN_ORB_MODULES) {
      // Built-ins must already be in normal form: a normalize pass over the
      // JSON-serialized document should be the identity. This guards against
      // shipping built-ins the normalizer would silently rewrite.
      expect(normalizeOrbModule(JSON.parse(JSON.stringify(builtin)))).toEqual(builtin);
    }
  });
});

describe("resolveOrbModule", () => {
  it("prefers the provided map, then built-ins, then classic", () => {
    const custom = normalizeOrbModule({
      id: "halo", // shadows the built-in on purpose
      name: "Patched Halo",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
    });
    const map = new Map([["halo", custom!]]);
    expect(resolveOrbModule("halo", map).name).toBe("Patched Halo");
    expect(resolveOrbModule("halo", null)).toBe(BUILTIN_ORB_MODULE_MAP.get("halo"));
    expect(resolveOrbModule("missing", map).id).toBe(FALLBACK_ORB_MODULE_ID);
    expect(resolveOrbModule(undefined, map).id).toBe(FALLBACK_ORB_MODULE_ID);
  });
});
