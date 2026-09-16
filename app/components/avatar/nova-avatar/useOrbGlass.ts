"use client";

import { useId } from "react";
import { useLiteMode } from "../../dashboard/experienceModeSetting";
import { supportsSvgBackdropFilter } from "../orb-glass/glass-model";
import type { NovaAvatarTheme } from "../theme-model/types";

export function useOrbGlass({ theme, hydrated }: { theme: NovaAvatarTheme; hydrated: boolean }) {
  // "Liquid glass" overlay (SVG displacement + silver-room reflection + gloss;
  // see NovaOrbGlass). Each mount gets a unique filter id so multiple orbs
  // (dashboard + config preview) don't collide on one <filter>. The reflection
  // drift only runs when it can actually be seen and lite mode allows motion.
  const glass = theme.glass;
  const lite = useLiteMode();
  const rawFilterId = useId();
  // Chromium caches backdrop-filter URL references aggressively. Include every
  // filter-shaping value in the id so slider/checkbox edits force a rebuild.
  const glassFilterId = [
    `nova-orb-glass-${rawFilterId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    glass.displace,
    glass.refractPower,
    glass.smoothness,
    glass.localStretch + 100,
    glass.flipVertical ? 1 : 0,
    // ×2 keeps the 0.5-step blur an integer so the id has no "." (kept valid
    // as a url(#id) reference).
    Math.round(glass.imageBlur * 2),
    glass.refractionOpacity,
  ].join("-");
  const glassEnabled = glass.enabled;
  const glassDriftActive = glassEnabled && !lite && glass.reflection > 0 && glass.drift > 0;
  // WebKit / iOS ignore `backdrop-filter: url(#svg)`, so the displacement
  // refraction never paints there — fall back to a CSS filter-function frost.
  // Gated on `hydrated` so SSR and the first client paint both use the SVG path
  // (no hydration mismatch); the detection only kicks in after mount.
  const svgBackdrop = !hydrated || supportsSvgBackdropFilter();
  return { glass, glassFilterId, glassEnabled, glassDriftActive, svgBackdrop };
}
