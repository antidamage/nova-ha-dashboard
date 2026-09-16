"use client";

import { useRef } from "react";
import type { SpectrumCursor } from "../../../../lib/types";
import { ColorEncoder, type ColorEncoderChannel } from "../../ColorEncoder";
import { hsvToRgb, rgbToHsv, type Hsva } from "../../colorEncoderModel";
import type { SpectrumValue } from "../lighting";

/**
 * The zone's one colour-and-level control: a 200px `ColorEncoder`
 * (specs/color-encoder.md). Hue and saturation become `rgb_color` at full
 * value; the brightness light is the zone's `brightness_pct`. There is no
 * second brightness control on the card.
 *
 * With every light off, hue and saturation are inert — a colour command would
 * otherwise turn the zone on in a colour nobody could see being chosen — but
 * brightness still works, since raising it is how the zone comes back on.
 */
export function ZoneColorEncoder({
  brightness,
  className,
  colorEnabled,
  disabled,
  knobSkin,
  label = "Lights",
  size = 200,
  spectrum,
  zoneId,
  onBrightnessChange,
  onBrightnessCommit,
  onColorCommit,
  onSpectrumChange,
}: {
  brightness: number;
  /** Added to the wrapper, for surfaces that lay the dial out differently. */
  className?: string;
  colorEnabled: boolean;
  disabled: boolean;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  label?: string;
  /** Dial diameter in px; the zone card uses 200, Quick Access 56. */
  size?: number;
  spectrum: SpectrumValue;
  zoneId: string;
  onBrightnessChange: (value: number) => void;
  onBrightnessCommit: (value: number) => void;
  onColorCommit: (rgb: [number, number, number], brightnessPct: number, cursor: SpectrumCursor) => void;
  onSpectrumChange: (value: SpectrumValue) => void;
}) {
  // Lighting opens on brightness: dimming a room is what this card is reached
  // for, colour far less often (Adeline, 2026-09-11).
  const channelRef = useRef<ColorEncoderChannel>("brightness");
  // Grey and white carry no hue. Remember the last real one so turning
  // saturation down to zero and back up does not snap the dial to red.
  const hueMemory = useRef<Record<string, number>>({});
  const derived = rgbToHsv(spectrum.preview);
  if (derived.s >= 1) hueMemory.current[zoneId] = derived.h;
  const value: Hsva = {
    h: derived.s >= 1 ? derived.h : hueMemory.current[zoneId] ?? derived.h,
    s: derived.s,
    v: brightness,
    a: 100,
  };

  const spectrumFor = (next: Hsva): SpectrumValue => ({
    cursor: { x: next.h / 359, y: 1 - next.s / 100 },
    preview: hsvToRgb(next.h, next.s, 100),
  });

  return (
    <div className={className ? `zone-color-encoder ${className}` : "zone-color-encoder"}>
      <ColorEncoder
        ariaLabel="Zone lights"
        defaultChannel="brightness"
        demoTooltipTitle="Lights"
        demoTooltip="Tap to switch between brightness, saturation and hue. Turn it like a knob."
        disabled={disabled}
        knobSkin={knobSkin}
        label={label}
        size={size}
        value={value}
        onActiveChannelChange={(channel) => {
          channelRef.current = channel;
        }}
        onChange={(next) => {
          if (channelRef.current === "brightness") {
            onBrightnessChange(Math.round(next.v));
            return;
          }
          if (!colorEnabled) return;
          if (next.s >= 1) hueMemory.current[zoneId] = next.h;
          onSpectrumChange(spectrumFor(next));
        }}
        onCommit={(next) => {
          if (channelRef.current === "brightness") {
            onBrightnessCommit(Math.round(next.v));
            return;
          }
          if (!colorEnabled) return;
          const committed = spectrumFor(next);
          onColorCommit(committed.preview, Math.round(next.v) || 100, committed.cursor);
        }}
      />
    </div>
  );
}
