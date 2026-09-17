import { describe, expect, it } from "vitest";
import {
  normalizeOrbLayer,
  type OrbArcFieldLayer,
  type OrbLineFieldLayer,
} from "../orb-modules";

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

  it("takes a ring's linear gradient and inset shadow, and drops empty ones", () => {
    const plain = normalizeOrbLayer({ type: "ring", radius: 0.9, width: 0.1, color: { hex: "#000000" } });
    expect(plain).not.toHaveProperty("gradient");
    expect(plain).not.toHaveProperty("innerShadow");

    const shaded = normalizeOrbLayer({
      type: "ring",
      radius: 0.884,
      width: 0.161,
      color: { hex: "#000000", alpha: 0 },
      gradient: {
        angle: 160,
        stops: [
          { at: 0, color: { hex: "#000000", alpha: 0.42 } },
          { at: 1, color: { hex: "#ffffff", alpha: 0.18 } },
        ],
      },
      innerShadow: { blur: 0.0805, color: { hex: "#000000", alpha: 0.55 } },
    });
    expect(shaded).toMatchObject({
      gradient: { angle: 160 },
      innerShadow: { blur: 0.0805 },
    });
    expect((shaded as { gradient: { stops: unknown[] } }).gradient.stops).toHaveLength(2);

    // A gradient with no stops, and a shadow with no blur, paint nothing.
    const empty = normalizeOrbLayer({
      type: "ring",
      radius: 0.9,
      width: 0.1,
      color: { hex: "#000000" },
      gradient: { angle: 160, stops: [] },
      innerShadow: { blur: 0, color: { hex: "#000000" } },
    });
    expect(empty).not.toHaveProperty("gradient");
    expect(empty).not.toHaveProperty("innerShadow");
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
