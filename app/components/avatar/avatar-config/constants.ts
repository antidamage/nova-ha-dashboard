"use client";

import type { AvatarSlotChoice, GlassSliderKey } from "./types";

export const AVATAR_SLOTS: AvatarSlotChoice[] = [
  { slot: "gradientCenter", label: "Gradient Center", detail: "Inner glow" },
  { slot: "gradientOuter", label: "Gradient Outer", detail: "Outer falloff" },
  { slot: "gymNumber", label: "Status Orb Label", detail: "Counter colour" },
  { slot: "gradientAlert", label: "Alert", detail: "Gym overdue pulse" },
  { slot: "voiceGlow", label: "Voice Glow", detail: "Listening halo" },
  { slot: "line0", label: "Line 1", detail: "First arc colour" },
  { slot: "line1", label: "Line 2", detail: "Second arc colour" },
  { slot: "line2", label: "Line 3", detail: "Third arc colour" },
];

/** Swatch render size in CSS pixels (the trigger slot is 44px). */
export const ORB_SWATCH_SIZE = 44;

// Most knobs are 0-100 magnitudes; a slider may override min/max/step/unit for
// the exceptions (localStretch is signed, imageBlur is a direct 0-10px value).
export const GLASS_SLIDERS: {
  key: GlassSliderKey;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}[] = [
  { key: "displace", label: "Refraction", description: "How hard the glass bends the page behind the whole orb" },
  { key: "localStretch", label: "Background size", description: "Size of the background sampled through the glass: negative shrinks, positive enlarges (up to 4×)", min: -100, max: 300 },
  { key: "refractPower", label: "Refraction curve", description: "Curvature of the glass dome — low is a near-flat pane, high piles refraction into a thick fisheye rim" },
  { key: "smoothness", label: "Melt", description: "Liquid softening of the refraction" },
  { key: "imageBlur", label: "Blur", description: "Frosted-glass blur of the refracted image seen through the orb", min: 0, max: 10, step: 0.5, unit: "px" },
  { key: "refractionOpacity", label: "Refraction opacity", description: "Opacity of the whole refraction: 100 is full glass, 0 shows the plain page through the orb" },
  { key: "clarity", label: "Clarity", description: "How clear the orb centre goes so the refraction reads through" },
  { key: "gloss", label: "Gloss", description: "Key-light highlight fading in from the top edge" },
  { key: "reflection", label: "Reflection", description: "Silver-room reflection fading in from the rim" },
  { key: "drift", label: "Drift", description: "How far the reflection flows as the orb moves" },
  { key: "shadow", label: "Shadow", description: "Depth of the shadow the orb casts" },
];

export const PREVIEW_SIZE = 150;
// Same easing as the home-page orb (NovaAvatar's scrollScale defaults): once
// pinned, the preview shrinks to half size over the next 300px of scroll.
export const PREVIEW_SCROLL_SCALE_DISTANCE = 300;
export const PREVIEW_SCROLL_SCALE_MIN = 0.5;
