import { describe, expect, it } from "vitest";
import {
  concentricLayerRadius,
  concentricLayerScale,
  glassBoxShadow,
  glassCssBackdropFilter,
  imageTransformDisplacement,
} from "../../NovaOrbGlass";
import { DEFAULT_NOVA_GLASS_SETTINGS, type NovaGlassSettings } from "../../avatarThemeModel";

describe("concentric glass layers", () => {
  it("makes each nested lens circle smaller than the previous", () => {
    expect(concentricLayerRadius(0)).toBeGreaterThan(concentricLayerRadius(1));
    expect(concentricLayerRadius(1)).toBeGreaterThan(concentricLayerRadius(7));
  });

  it("keeps inner layers individually weaker while they compound", () => {
    expect(concentricLayerScale(0)).toBeGreaterThan(concentricLayerScale(7));
  });
});

describe("glassCssBackdropFilter (WebKit/iOS fallback)", () => {
  const withGlass = (overrides: Partial<NovaGlassSettings>): NovaGlassSettings => ({
    ...DEFAULT_NOVA_GLASS_SETTINGS,
    ...overrides,
  });

  it("emits only supported filter functions (no url() reference)", () => {
    const value = glassCssBackdropFilter(DEFAULT_NOVA_GLASS_SETTINGS);
    expect(value).toMatch(/^blur\([\d.]+px\) saturate\([\d.]+\) brightness\([\d.]+\)$/);
    expect(value).not.toContain("url(");
  });

  it("produces a visible frost at the default settings", () => {
    const blur = Number(glassCssBackdropFilter(DEFAULT_NOVA_GLASS_SETTINGS).match(/blur\(([\d.]+)px\)/)![1]);
    expect(blur).toBeGreaterThan(0);
  });

  it("collapses to a clear disc when refraction is dialled to zero", () => {
    expect(glassCssBackdropFilter(withGlass({ refractionOpacity: 0 }))).toBe(
      "blur(0.0px) saturate(1.00) brightness(1.00)",
    );
  });

  it("blurs harder as the frosted (imageBlur) knob rises", () => {
    const soft = Number(glassCssBackdropFilter(withGlass({ imageBlur: 0 })).match(/blur\(([\d.]+)px\)/)![1]);
    const frosted = Number(glassCssBackdropFilter(withGlass({ imageBlur: 10 })).match(/blur\(([\d.]+)px\)/)![1]);
    expect(frosted).toBeGreaterThan(soft);
  });
});

describe("glassBoxShadow", () => {
  it("layers the cast into a rapid falloff that levels out", () => {
    const casts = [...glassBoxShadow(DEFAULT_NOVA_GLASS_SETTINGS).matchAll(
      /0 [\d.]+px ([\d.]+)px rgba\(0, 0, 0, ([\d.]+)\)/g,
    )];

    expect(casts).toHaveLength(3);
    const blurs = casts.map((cast) => Number(cast[1]));
    const alphas = casts.map((cast) => Number(cast[2]));
    expect(blurs[0]).toBeLessThan(blurs[1]);
    expect(blurs[1]).toBeLessThan(blurs[2]);
    expect(alphas[0]).toBeGreaterThan(alphas[1]);
    expect(alphas[1]).toBeGreaterThan(alphas[2]);
    // Each step keeps a larger share than the last: steep first, then flat.
    expect(alphas[2] / alphas[1]).toBeGreaterThan(alphas[1] / alphas[0]);
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
