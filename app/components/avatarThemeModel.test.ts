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
      refractPower: -30,
      smoothness: 51.7,
      gloss: 12,
      shadow: 0,
      reflection: 100,
      drift: 33,
    });
    expect(glass).toEqual({
      enabled: false,
      displace: 100,
      refractPower: 0,
      smoothness: 52,
      clarity: DEFAULT_NOVA_GLASS_SETTINGS.clarity,
      gloss: 12,
      shadow: 0,
      reflection: 100,
      drift: 33,
    });
  });

  it("falls back to the default for non-finite knobs and non-boolean enabled", () => {
    const glass = normalizeNovaGlassSettings({
      enabled: "yes" as unknown as boolean,
      displace: Number.NaN,
      refractPower: "x" as unknown as number,
    });
    expect(glass.enabled).toBe(DEFAULT_NOVA_GLASS_SETTINGS.enabled);
    expect(glass.displace).toBe(DEFAULT_NOVA_GLASS_SETTINGS.displace);
    expect(glass.refractPower).toBe(DEFAULT_NOVA_GLASS_SETTINGS.refractPower);
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
