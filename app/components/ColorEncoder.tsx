"use client";

/**
 * ColorEncoder — Nova's rotary colour control (specs/color-encoder.md).
 *
 * The dial itself is `RotaryEncoder`; this file is the colour half of it. A row
 * of lights across the knob says which channel it is turning, and tapping
 * cycles them. The sunken ring around the dial carries the resulting colour and
 * is the control's *only* colour readout — no hex, no RGB, no number anywhere
 * on it. The label curves around the outside of the knob, along the top.
 *
 * The base carries the layers, the relative-angle drag, the clicks, the rings
 * and the light/dark treatment; `useHsvaDial` carries the channels and the rule
 * for adopting an outside value, shared with the lights' `LightEncoder`. What
 * lives here is the picker's paint: the checkerboard and colour, the
 * brightness-keyed glow, and the form input.
 */
import { hsvaToCss, hsvaToFormValue, hsvaToRgb, type Hsva } from "./colorEncoderModel";
import {
  ENCODER_MAX_SIZE,
  ENCODER_MIN_SIZE,
  RotaryEncoder,
  type RotaryEncoderRing,
} from "./RotaryEncoder";
import {
  CHANNEL_LABEL,
  CHANNEL_SENSITIVITY,
  channelCaption,
  clamp,
  useHsvaDial,
  type ColorEncoderChannel,
} from "./useHsvaDial";

export type { ColorEncoderChannel } from "./useHsvaDial";

export const COLOR_ENCODER_CHANNELS: ColorEncoderChannel[] = ["hue", "brightness", "saturation"];
export const COLOR_ENCODER_CHANNELS_WITH_ALPHA: ColorEncoderChannel[] = [
  "hue",
  "brightness",
  "saturation",
  "alpha",
];

export const COLOR_ENCODER_MIN_SIZE = ENCODER_MIN_SIZE;
export const COLOR_ENCODER_MAX_SIZE = ENCODER_MAX_SIZE;

/** A ring on the colour dial: the base's ring, unchanged. */
export type ColorEncoderRing = RotaryEncoderRing;

export type ColorEncoderProps = {
  activeChannel?: ColorEncoderChannel;
  ariaLabel?: string;
  channels?: ColorEncoderChannel[];
  className?: string;
  defaultChannel?: ColorEncoderChannel;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  format?: "hex" | "rgb";
  /** Shown on the knob, above the lights. */
  label?: string;
  /** Forces the bevel/LED skin instead of reading it from the painted surface. Default "auto". */
  knobSkin?: "auto" | "dark" | "light";
  name?: string;
  /** Up to five slider rings, innermost first. */
  rings?: ColorEncoderRing[];
  sensitivity?: Partial<Record<ColorEncoderChannel, number>>;
  /** Knob diameter in px, clamped to 50–200. */
  size?: number;
  value: Hsva;
  /** Locks and tucks the rings as the climate knobs do (RotaryEncoder's prop). */
  tuckAfterMs?: number;
  onActiveChannelChange?: (channel: ColorEncoderChannel) => void;
  onChange: (value: Hsva) => void;
  onCommit?: (value: Hsva) => void;
};

export function ColorEncoder({
  activeChannel,
  ariaLabel,
  channels = COLOR_ENCODER_CHANNELS,
  className,
  defaultChannel,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  format = "hex",
  label,
  knobSkin,
  name,
  rings,
  sensitivity,
  size = ENCODER_MAX_SIZE,
  tuckAfterMs,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: ColorEncoderProps) {
  const dial = useHsvaDial({ activeChannel, channels, defaultChannel, size, value, onActiveChannelChange });
  const { channel, colour, dialSize } = dial;

  const withAlpha = channels.includes("alpha");
  const rgb = hsvaToRgb(colour);
  const glowAmount = clamp((colour.v - 50) / 50, 0, 1) * (withAlpha ? colour.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

  return (
    <>
      <RotaryEncoder
        variantClassName="color-encoder"
        className={className}
        ariaLabel={ariaLabel ?? (label ? undefined : "Colour")}
        ariaValueText={`${CHANNEL_LABEL[channel]} ${Math.round(dial.current)}${channel === "hue" ? "°" : "%"}`}
        checker
        color={hsvaToCss(withAlpha ? colour : { ...colour, a: 100 })}
        demoTooltip={demoTooltip}
        demoTooltipTitle={demoTooltipTitle}
        disabled={disabled}
        title={label}
        faceBottom={channelCaption(channel, dialSize)}
        glow={glow}
        knobSkin={knobSkin}
        leds={dial.leds}
        activeLed={channel}
        onActiveLedChange={dial.selectChannel}
        range={channel === "hue" ? { min: 0, max: 360, wrap: true } : { min: 0, max: 100 }}
        rings={rings}
        sensitivity={sensitivity?.[channel] ?? CHANNEL_SENSITIVITY[channel]}
        size={size}
        tuckAfterMs={tuckAfterMs}
        value={dial.current}
        onPressedChange={dial.setPressed}
        onChange={(next) => onChange(dial.apply(next))}
        onCommit={(next) => onCommit?.(dial.apply(next))}
      />
      {name ? <input type="hidden" name={name} value={hsvaToFormValue(colour, format, withAlpha)} /> : null}
    </>
  );
}
