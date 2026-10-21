"use client";

/**
 * LightEncoder — the lighting knob (specs/light-encoder.md).
 *
 * The colour picker's channels and value model (`useHsvaDial`) on the shared
 * dial, with the lights' own band: the light's colour fills from the lit
 * channel's zero point to the mark, soft at both ends, and the glow is that
 * same arc blurred. Brightness, hue, saturation, left to right; brightness is
 * lit on load.
 */
import { useMemo } from "react";
import type { Hsva } from "./colorEncoderModel";
import { lightBand } from "./lightEncoderModel";
import { ENCODER_MAX_SIZE, RotaryEncoder } from "./RotaryEncoder";
import {
  CHANNEL_LABEL,
  CHANNEL_SENSITIVITY,
  channelCaption,
  useHsvaDial,
  type ColorEncoderChannel,
} from "./useHsvaDial";

/** Brt, Hue, Sat (Adeline, 2026-10-21). */
export const LIGHT_ENCODER_CHANNELS: ColorEncoderChannel[] = ["brightness", "hue", "saturation"];

export type LightEncoderProps = {
  ariaLabel?: string;
  className?: string;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  knobSkin?: "auto" | "dark" | "light";
  /** Shown on the knob, above the lights. */
  label?: string;
  /** Knob diameter in px, clamped to 50–200. */
  size?: number;
  value: Hsva;
  onActiveChannelChange?: (channel: ColorEncoderChannel) => void;
  onChange: (value: Hsva) => void;
  onCommit?: (value: Hsva) => void;
};

export function LightEncoder({
  ariaLabel,
  className,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  knobSkin,
  label,
  size = ENCODER_MAX_SIZE,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: LightEncoderProps) {
  const dial = useHsvaDial({
    channels: LIGHT_ENCODER_CHANNELS,
    defaultChannel: "brightness",
    size,
    value,
    onActiveChannelChange,
  });
  const { channel, colour, dialSize } = dial;
  const band = useMemo(() => lightBand(channel, colour), [channel, colour]);

  return (
    <RotaryEncoder
      variantClassName="light-encoder"
      className={className}
      ariaLabel={ariaLabel ?? (label ? undefined : "Lights")}
      ariaValueText={`${CHANNEL_LABEL[channel]} ${Math.round(dial.current)}${channel === "hue" ? "°" : "%"}`}
      ringPaint={band.paint}
      ringMark={band.mark}
      glowPaint={band.glowPaint}
      demoTooltip={demoTooltip}
      demoTooltipTitle={demoTooltipTitle}
      disabled={disabled}
      title={label}
      faceBottom={channelCaption(channel, dialSize)}
      knobSkin={knobSkin}
      leds={dial.leds}
      activeLed={channel}
      onActiveLedChange={dial.selectChannel}
      range={channel === "hue" ? { min: 0, max: 360, wrap: true } : { min: 0, max: 100 }}
      sensitivity={CHANNEL_SENSITIVITY[channel]}
      size={size}
      value={dial.current}
      onPressedChange={dial.setPressed}
      onChange={(next) => onChange(dial.apply(next))}
      onCommit={(next) => onCommit?.(dial.apply(next))}
    />
  );
}
