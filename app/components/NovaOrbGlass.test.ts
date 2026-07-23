import { describe, expect, it } from "vitest";
import {
  concentricLayerRadius,
  concentricLayerScale,
  imageTransformDisplacement,
} from "./NovaOrbGlass";

describe("concentric glass layers", () => {
  it("makes each nested lens circle smaller than the previous", () => {
    expect(concentricLayerRadius(0)).toBeGreaterThan(concentricLayerRadius(1));
    expect(concentricLayerRadius(1)).toBeGreaterThan(concentricLayerRadius(7));
  });

  it("keeps inner layers individually weaker while they compound", () => {
    expect(concentricLayerScale(0)).toBeGreaterThan(concentricLayerScale(7));
  });
});

describe("imageTransformDisplacement", () => {
  it("maps +100 to a 2x apparent background size", () => {
    expect(imageTransformDisplacement(1, 0.5, 100, false)).toEqual({ dx: -0.5, dy: -0.25 });
  });

  it("maps -50 to a 0.5x apparent background size", () => {
    expect(imageTransformDisplacement(0.5, 0.25, -50, false)).toEqual({ dx: 0.5, dy: 0.25 });
  });

  it("inverts the source y coordinate when vertical flip is enabled", () => {
    expect(imageTransformDisplacement(0.25, 0.5, 0, true)).toEqual({ dx: 0, dy: -1 });
  });
});
