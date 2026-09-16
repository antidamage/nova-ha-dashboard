"use client";

import { type CSSProperties } from "react";
import type { NovaGlassSettings } from "../theme-model/types";
import { glassCopyBlurPx } from "./glass-model";

/**
 * The WebKit / iOS refraction layer.
 *
 * WebKit ignores `backdrop-filter: url(#svg)` (the live-backdrop refraction the
 * disc uses everywhere else), but it DOES honour the same SVG filter as a
 * regular `filter:` — it just needs something of its own to filter. So this
 * renders a self-contained copy of the dashboard backdrop (the exact same
 * `--cyber-bg` + faint grid CSS variables the real `.fluid-background` /
 * `.dashboard-shell` paint, so it matches the page without hard-coding any
 * colour) and runs it through the lens filter. The grid gives the lens real
 * contrast to bend; the solid base keeps it seamless with the page. A rim mask
 * (in CSS) fades the copy out at the edge so the disc's real frosted backdrop
 * shows through there and continues the surroundings.
 *
 * Tradeoff vs the Chromium live path: this refracts a *reproduction* of the
 * background, not arbitrary live widgets sitting behind the orb — invisible in
 * practice since the orb floats at the top of the page over mostly-background.
 * Only mounted on the WebKit path; Chromium refracts the real backdrop directly.
 */
export function NovaOrbGlassBackdropCopy({
  filterId,
  glass,
}: {
  filterId: string;
  glass: NovaGlassSettings;
}) {
  const blur = glassCopyBlurPx(glass);
  const filter =
    blur > 0.05 ? `url(#${filterId}) blur(${blur.toFixed(1)}px)` : `url(#${filterId})`;
  return (
    <div
      className="nova-orb-refract-copy"
      aria-hidden="true"
      style={{ filter, WebkitFilter: filter } as CSSProperties}
    />
  );
}
