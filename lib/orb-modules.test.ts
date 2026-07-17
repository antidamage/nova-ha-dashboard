import { describe, expect, it } from "vitest";
import {
  BUILTIN_ORB_MODULES,
  BUILTIN_ORB_MODULE_MAP,
  FALLBACK_ORB_MODULE_ID,
  hexToRgb,
  isValidOrbModuleId,
  normalizeOrbColorRef,
  normalizeOrbLayer,
  normalizeOrbModule,
  ORB_MODULE_FORMAT_VERSION,
  resolveOrbColor,
  resolveOrbModule,
  type OrbArcFieldLayer,
  type OrbLineFieldLayer,
  type OrbPalette,
} from "./orb-modules";

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

describe("normalizeOrbLayer", () => {
  it("drops unknown layer types for forward compatibility", () => {
    expect(normalizeOrbLayer({ type: "hologram" })).toBeNull();
    expect(normalizeOrbLayer("junk")).toBeNull();
  });

  it("fills arcField defaults and orders min/max pairs", () => {
    const layer = normalizeOrbLayer({
      type: "arcField",
      count: 10,
      radiusMin: 0.9,
      radiusMax: 0.2, // inverted on purpose
      widthMin: 0.01,
      widthMax: 0.005, // inverted on purpose
      idleSweepMin: 0.001,
      idleSweepMax: 0.0002,
      loadSweep: 1,
      speedMin: 0.05,
      speedMax: 0.1,
      loadSpeed: 0.25,
    }) as OrbArcFieldLayer;
    expect(layer.type).toBe("arcField");
    expect(layer.radiusMax).toBeGreaterThanOrEqual(layer.radiusMin);
    expect(layer.widthMax).toBeGreaterThanOrEqual(layer.widthMin);
    expect(layer.idleSweepMax).toBeGreaterThanOrEqual(layer.idleSweepMin);
    // Missing colors default to the three theme line slots.
    expect(layer.colors).toEqual([{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }]);
  });

  it("keeps disc gradient circles only when supplied", () => {
    const plain = normalizeOrbLayer({ type: "disc", stops: [{ at: 0, color: { hex: "#000000" } }] });
    expect(plain).not.toBeNull();
    expect(plain).not.toHaveProperty("gradientFrom");

    const focused = normalizeOrbLayer({
      type: "disc",
      gradientFrom: { x: 0, y: 0.5, radius: 0.1 },
      gradientTo: { x: 0, y: 0.2, radius: 1.1 },
      stops: [
        { at: 0, color: { hex: "#000000", alpha: 0 } },
        { at: 1, color: { theme: "innerShadow" } },
      ],
    });
    expect(focused).toMatchObject({
      gradientFrom: { x: 0, y: 0.5, radius: 0.1 },
      gradientTo: { x: 0, y: 0.2, radius: 1.1 },
    });
  });

  it("normalizes line layers with endpoint fallbacks and cap handling", () => {
    const layer = normalizeOrbLayer({
      type: "line",
      from: { x: -0.5, y: -0.5 },
      to: { x: 0.5, y: 0.5 },
      width: 0.18,
      color: { theme: "gradientCenter" },
      cap: "butt",
    });
    expect(layer).toEqual({
      type: "line",
      from: { x: -0.5, y: -0.5 },
      to: { x: 0.5, y: 0.5 },
      width: 0.18,
      color: { theme: "gradientCenter" },
      cap: "butt",
    });
    // Default round cap is omitted from the normal form.
    expect(normalizeOrbLayer({ type: "line", from: {}, to: {}, width: 0.1 })).not.toHaveProperty("cap");
  });

  it("rejects polygons with fewer than three points", () => {
    expect(normalizeOrbLayer({ type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
    expect(normalizeOrbLayer({ type: "polygon" })).toBeNull();
  });

  it("normalizes polygon fill vs stroke shapes", () => {
    const triangle = [{ x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    const filled = normalizeOrbLayer({ type: "polygon", points: triangle, fill: true, width: 0.5 });
    // Fill drops the stroke width; stroke keeps it and drops fill.
    expect(filled).toMatchObject({ type: "polygon", fill: true });
    expect(filled).not.toHaveProperty("width");
    const stroked = normalizeOrbLayer({ type: "polygon", points: triangle, width: 0.05, close: false });
    expect(stroked).toMatchObject({ type: "polygon", width: 0.05, close: false });
    expect(stroked).not.toHaveProperty("fill");
  });

  it("fills lineField defaults, tracks, and ordered ranges", () => {
    const minimal = normalizeOrbLayer({ type: "lineField" }) as OrbLineFieldLayer;
    // A bare stanza still animates: one horizontal track, theme line colors.
    expect(minimal.tracks).toEqual([{ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }]);
    expect(minimal.colors).toEqual([{ theme: "line1" }, { theme: "line2" }, { theme: "line3" }]);
    expect(minimal.idleLengthMax).toBeGreaterThanOrEqual(minimal.idleLengthMin);
    expect(minimal.widthMax).toBeGreaterThanOrEqual(minimal.widthMin);
    expect(minimal).not.toHaveProperty("colorMode");

    const custom = normalizeOrbLayer({
      type: "lineField",
      tracks: [
        { from: { x: -0.5, y: -0.5 }, to: { x: 0.5, y: 0.5 } },
        { from: { x: -0.5, y: 0.5 }, to: { x: 0.5, y: -0.5 } },
      ],
      colorMode: "random",
    }) as OrbLineFieldLayer;
    expect(custom.tracks).toHaveLength(2);
    expect(custom.colorMode).toBe("random");
  });

  it("keeps colorMode random on arcField and strips the cycle default", () => {
    const base = {
      type: "arcField",
      count: 5,
      radiusMin: 0.1,
      radiusMax: 0.9,
      widthMin: 0.01,
      widthMax: 0.05,
      idleSweepMin: 0.001,
      idleSweepMax: 0.01,
      loadSweep: 1,
      speedMin: 0.05,
      speedMax: 0.1,
      loadSpeed: 0.25,
    };
    expect(normalizeOrbLayer({ ...base, colorMode: "random" })).toMatchObject({ colorMode: "random" });
    expect(normalizeOrbLayer({ ...base, colorMode: "cycle" })).not.toHaveProperty("colorMode");
    expect(normalizeOrbLayer({ ...base, colorMode: "rainbow" })).not.toHaveProperty("colorMode");
  });

  it("sorts gradient stops by position", () => {
    const layer = normalizeOrbLayer({
      type: "arc",
      radius: 1,
      width: 0.1,
      from: 0,
      to: 0.5,
      stops: [
        { at: 1, color: { hex: "#ffffff" } },
        { at: 0, color: { hex: "#000000" } },
      ],
    });
    expect(layer).toMatchObject({
      stops: [
        { at: 0, color: { hex: "#000000" } },
        { at: 1, color: { hex: "#ffffff" } },
      ],
    });
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
