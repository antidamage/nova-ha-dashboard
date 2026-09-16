"use client";

import type { ThemeColorValue } from "../../accentColor";
import {
  COLOR_ENCODER_CHANNELS,
  COLOR_ENCODER_CHANNELS_WITH_ALPHA,
  ColorEncoder,
  type ColorEncoderRing,
} from "../../ColorEncoder";
import { hsvaFromThemeColor, themeColorFromHsva } from "../../colorEncoderModel";

/**
 * The configuration colour control: a `ColorEncoder` over a stored
 * `ThemeColorValue` (specs/color-encoder.md). Hue, brightness and saturation
 * write the colour; passing `opacity` adds the fourth light, which writes the
 * slot's own sibling opacity field. `onPreview` is local only and `onCommit`
 * is the single persistence boundary, once per gesture — the same contract as
 * `SliderControlPanel`.
 */
export function ColorEncoderPanel({
  knobSkin,
  label,
  onCommit,
  onPreview,
  opacity,
  rings,
  size = 100,
  value,
}: {
  label: string;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  onCommit: (value: ThemeColorValue, opacity: number) => void;
  onPreview: (value: ThemeColorValue, opacity: number) => void;
  /**
   * 0–100. When given, the dial gains its alpha light. The prop keeps the
   * storage field's name: the theme calls this opacity, the dial calls the
   * channel alpha (Adeline, 2026-09-11).
   */
  opacity?: number;
  /**
   * The slot's own extra sliders, as rings round the dial
   * (specs/color-encoder.md, "The map colour slots carry their sliders as
   * rings"). A slot with none renders exactly as before.
   */
  rings?: ColorEncoderRing[];
  size?: number;
  value: ThemeColorValue;
}) {
  const withOpacity = opacity !== undefined;
  return (
    <div className="config-color-encoder">
      <ColorEncoder
        ariaLabel={`${label} colour`}
        channels={withOpacity ? COLOR_ENCODER_CHANNELS_WITH_ALPHA : COLOR_ENCODER_CHANNELS}
        demoTooltipTitle={label}
        demoTooltip="Tap to switch channel. Turn it like a knob."
        knobSkin={knobSkin}
        label={label}
        rings={rings}
        size={size}
        value={hsvaFromThemeColor(value, opacity)}
        onChange={(next) => onPreview(themeColorFromHsva(next, value), Math.round(next.a))}
        onCommit={(next) => onCommit(themeColorFromHsva(next, value), Math.round(next.a))}
      />
    </div>
  );
}
