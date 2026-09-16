"use client";

export type AvatarThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

/**
 * "Liquid glass" overlay settings for the status orb. These drive a DOM/SVG
 * layer that sits on top of the canvas orb (see NovaOrbGlass): an SVG
 * `feDisplacementMap` refracts the orb like a curved lens, a screen-blended
 * "silver room with overhead lights" reflection pans across it as the orb
 * moves on the page, and a gloss highlight + drop shadow sell the volume.
 *
 * The effect is DOM-only (SVG filters + blend modes), so unlike the orb
 * modules it has no tvOS counterpart — the Apple TV renderer simply never
 * draws it. Every knob is a 0-100 magnitude except `enabled`; the renderer
 * maps them to concrete pixel/filter values, so the stored model stays a set
 * of plain, hand-editable percentages. `localStretch` is the one signed
 * exception: it ranges from -100 to 100 around a neutral zero.
 */
export type NovaGlassSettings = {
  /** Master switch for the whole glass overlay. */
  enabled: boolean;
  /** backdrop-filter displacement scale — how far the lens refracts the page
   *  behind the orb (the whole disc refracts, artist "liquid glass" style). */
  displace: number;
  /** Signed size change of the refracted background image (-100..300).
   * 0 is neutral, +100 doubles it, +300 quadruples it, -100 collapses it. The
   * wide positive range lets the zoom read clearly; the old ±100 cap (max 2x)
   * was easy to miss over low-contrast content. */
  localStretch: number;
  /** Reverse the displacement map's vertical refraction direction. */
  flipVertical: boolean;
  /** Curvature of the modelled glass dome (0-100), driving how the concentric
   *  refraction rings accumulate. Low is a near-flat pane whose slope stays
   *  gentle across the disc; high is a near-full hemisphere whose slope runs
   *  away toward the rim, piling refraction into a thick fisheye edge. See
   *  refractDomeFullness / refractMagnitude in NovaOrbGlass. */
  refractPower: number;
  /** Gaussian blur on the displacement map — the "liquid"/melt softness. */
  smoothness: number;
  /** Gaussian blur (0-10px) applied to the refracted image itself, after the
   *  lens — a frosted-glass softening of what you see through the orb. Distinct
   *  from `smoothness`, which blurs the displacement map, not the image. A
   *  direct pixel value rather than a 0-100 magnitude. */
  imageBlur: number;
  /** Opacity (0-100) of the whole refraction group — cross-fades the refracted
   *  image back toward the plain (un-refracted) backdrop. 100 is full
   *  refraction; 0 shows the page unbent through the disc. */
  refractionOpacity: number;
  /** How see-through the orb core is — fades the canvas graphics toward the
   *  centre so the refraction reads through a mostly-clear middle. */
  clarity: number;
  /** Strength of the specular gloss highlight, fading in from the top edge. */
  gloss: number;
  /** Depth of the drop shadow cast beneath the orb. */
  shadow: number;
  /** Opacity of the silver-room reflection, fading in from the rim. */
  reflection: number;
  /** How far the reflection pans as the orb moves / the pointer sweeps. */
  drift: number;
};

export type NovaAvatarTheme = {
  gradientAlert: AvatarThemeColorValue;
  gradientCenter: AvatarThemeColorValue;
  gradientOuter: AvatarThemeColorValue;
  gymAlertThresholdHours: number;
  gymNumberColor: AvatarThemeColorValue;
  gymNumberOpacity: number;
  // Colour of the voice-listening glow ring that fades in behind the status orb
  // while this device owns an active voice conversation (see NovaAvatar). Unlike
  // the other orb colours this one skins a DOM element behind the canvas rather
  // than a canvas layer, so it is also surfaced as the --nova-avatar-voice-glow
  // CSS var; it is included in the renderer palette for cross-platform parity.
  voiceGlowColor: AvatarThemeColorValue;
  lineColors: [AvatarThemeColorValue, AvatarThemeColorValue, AvatarThemeColorValue];
  lineOpacities: [number, number, number];
  // Opacity (0..1) of the orb's dark inner bevel shadow. Shared config only —
  // intentionally not surfaced in the avatar config UI. All avatar renderers
  // (web + tvOS) reference this so the inner shadow stays consistent.
  innerShadowOpacity: number;
  // Id of the status orb module this theme renders with (see
  // lib/orb-modules.ts). The module defines the orb's layer stack — shape,
  // proportions, animation — while the colors above skin it. Unknown ids fall
  // back to the built-in "classic" module on every platform.
  orbModule: string;
  // Saved values for the per-module config sliders (OrbModule.settings),
  // keyed by module id then setting id, so each module keeps its own tuning
  // when the user switches between them. Values are kept as finite numbers
  // here; clamping to each setting's declared range happens at resolve time
  // (resolveOrbModuleSettings in lib/orb-modules.ts) so this model stays
  // dependency-free.
  orbModuleSettings: Record<string, Record<string, number>>;
  // "Liquid glass" overlay tuning (see NovaGlassSettings). Applies over any
  // orb module, so it lives on the theme rather than in a module's per-module
  // settings. DOM/SVG-only; no tvOS counterpart.
  glass: NovaGlassSettings;
  // How fast the alert pulses, over every orb module: 0-100, where 50 leaves a
  // module's declared `alertPulsePeriod` exactly as it is, lower is faster and
  // higher is slower and more sedate. Stored as a magnitude rather than as a
  // period so it stays meaningful across modules whose base periods differ
  // (1.0s to 1.6s); `alertPulseScale` turns it into the multiplier. Applies
  // over any module, so it sits on the theme beside `glass`.
  alertPulseRate: number;
};
