import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOVA_AVATAR_THEME,
  DEFAULT_NOVA_GLASS_SETTINGS,
  normalizeNovaAvatarTheme,
  normalizeNovaGlassSettings,
} from "./avatarThemeModel";

describe("normalizeNovaGlassSettings", () => {
  it("fills every knob from defaults when absent", () => {
    expect(normalizeNovaGlassSettings(undefined)).toEqual(DEFAULT_NOVA_GLASS_SETTINGS);
    expect(normalizeNovaGlassSettings({})).toEqual(DEFAULT_NOVA_GLASS_SETTINGS);
  });

  it("clamps magnitudes to 0-100 and rounds them", () => {
    const glass = normalizeNovaGlassSettings({
      enabled: false,
      displace: 240,
      localStretch: -130,
      flipVertical: true,
      refractPower: -30,
      smoothness: 51.7,
      imageBlur: 12.3,
      refractionOpacity: 150,
      gloss: 12,
      shadow: 0,
      reflection: 100,
      drift: 33,
    });
    expect(glass).toEqual({
      enabled: false,
      displace: 100,
      localStretch: -100,
      flipVertical: true,
      refractPower: 0,
      smoothness: 52,
      imageBlur: 10,
      refractionOpacity: 100,
      clarity: DEFAULT_NOVA_GLASS_SETTINGS.clarity,
      gloss: 12,
      shadow: 0,
      reflection: 100,
      drift: 33,
    });
  });

  it("allows the widened background-size range up to +300 and clamps beyond", () => {
    expect(normalizeNovaGlassSettings({ localStretch: 250 }).localStretch).toBe(250);
    expect(normalizeNovaGlassSettings({ localStretch: 400 }).localStretch).toBe(300);
    expect(normalizeNovaGlassSettings({ localStretch: -400 }).localStretch).toBe(-100);
  });

  it("falls back to the default for non-finite knobs and non-boolean enabled", () => {
    const glass = normalizeNovaGlassSettings({
      enabled: "yes" as unknown as boolean,
      displace: Number.NaN,
      refractPower: "x" as unknown as number,
    });
    expect(glass.enabled).toBe(DEFAULT_NOVA_GLASS_SETTINGS.enabled);
    expect(glass.displace).toBe(DEFAULT_NOVA_GLASS_SETTINGS.displace);
    expect(glass.localStretch).toBe(DEFAULT_NOVA_GLASS_SETTINGS.localStretch);
    expect(glass.flipVertical).toBe(DEFAULT_NOVA_GLASS_SETTINGS.flipVertical);
    expect(glass.refractPower).toBe(DEFAULT_NOVA_GLASS_SETTINGS.refractPower);
    expect(glass.imageBlur).toBe(DEFAULT_NOVA_GLASS_SETTINGS.imageBlur);
    expect(glass.refractionOpacity).toBe(DEFAULT_NOVA_GLASS_SETTINGS.refractionOpacity);
  });

  it("snaps the refracted-image blur to the nearest 0.5px within 0-10", () => {
    expect(normalizeNovaGlassSettings({ imageBlur: 3.3 }).imageBlur).toBe(3.5);
    expect(normalizeNovaGlassSettings({ imageBlur: 0.2 }).imageBlur).toBe(0);
    expect(normalizeNovaGlassSettings({ imageBlur: -5 }).imageBlur).toBe(0);
  });
});

describe("normalizeNovaAvatarTheme glass block", () => {
  it("adds the default glass block to a theme that predates it", () => {
    const { glass: _drop, ...withoutGlass } = DEFAULT_NOVA_AVATAR_THEME;
    const normalized = normalizeNovaAvatarTheme(withoutGlass);
    expect(normalized.glass).toEqual(DEFAULT_NOVA_GLASS_SETTINGS);
  });

  it("preserves a supplied glass block through normalization", () => {
    const normalized = normalizeNovaAvatarTheme({
      ...DEFAULT_NOVA_AVATAR_THEME,
      glass: { ...DEFAULT_NOVA_GLASS_SETTINGS, enabled: false, displace: 10 },
    });
    expect(normalized.glass.enabled).toBe(false);
    expect(normalized.glass.displace).toBe(10);
  });
});
