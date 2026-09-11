"use client";

/**
 * ColorEncoder — Nova's rotary colour control (specs/color-encoder.md).
 *
 * The dial itself is `RotaryEncoder`; this file is the colour half of it. A row
 * of lights across the knob says which channel it is turning, and tapping
 * cycles them. The sunken ring around the dial carries the resulting colour and
 * is the control's *only* colour readout — no hex, no RGB, no number anywhere
 * on it. The label sits on the knob face above the lights.
 *
 * The base carries the layers, the relative-angle drag, the clicks, the rings
 * and the light/dark treatment. What lives here is HSVA: which channel the knob
 * turns, the checkerboard and colour paint, the brightness-keyed glow, the rule
 * for adopting an outside value, and the form input.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  hsvaToCss,
  hsvaToFormValue,
  hsvaToRgb,
  normalizeHsva,
  wrapHue,
  type Hsva,
} from "./colorEncoderModel";
import {
  ENCODER_MAX_SIZE,
  ENCODER_MIN_SIZE,
  RotaryEncoder,
  type EncoderLed,
  type RotaryEncoderRing,
} from "./RotaryEncoder";
import { ARC_SPAN } from "./rotaryEncoderGeometry";

export type ColorEncoderChannel = "hue" | "brightness" | "saturation" | "alpha";

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

/**
 * Units of channel movement per degree the knob is turned. The index shows the
 * value, so the value moves at exactly the rate its own index angle implies: a
 * hue degree per degree, and 100/270 of a 0–100 channel per degree.
 */
const SENSITIVITY: Record<ColorEncoderChannel, number> = {
  hue: 1,
  brightness: 100 / ARC_SPAN,
  saturation: 100 / ARC_SPAN,
  alpha: 100 / ARC_SPAN,
};

const CHANNEL_LABEL: Record<ColorEncoderChannel, string> = {
  hue: "hue",
  brightness: "brightness",
  saturation: "saturation",
  alpha: "alpha",
};

const CHANNEL_CAPTION: Record<ColorEncoderChannel, [long: string, short: string]> = {
  hue: ["HUE", "HUE"],
  brightness: ["BRIGHT", "BRT"],
  saturation: ["SAT", "SAT"],
  alpha: ["ALPHA", "ALPH"],
};

/** Below this the caption font is pinned at its 10px floor (10 / 0.075). */
const CAPTION_SHORT_BELOW_PX = 10 / 0.075;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function channelValue(value: Hsva, channel: ColorEncoderChannel) {
  if (channel === "hue") return value.h;
  if (channel === "brightness") return value.v;
  if (channel === "saturation") return value.s;
  return value.a;
}

function withChannel(value: Hsva, channel: ColorEncoderChannel, next: number): Hsva {
  if (channel === "hue") return { ...value, h: wrapHue(next) };
  if (channel === "brightness") return { ...value, v: clamp(next, 0, 100) };
  if (channel === "saturation") return { ...value, s: clamp(next, 0, 100) };
  return { ...value, a: clamp(next, 0, 100) };
}

function sameStoredColour(left: Hsva, right: Hsva) {
  const leftRgb = hsvaToRgb(left);
  const rightRgb = hsvaToRgb(right);
  return leftRgb.every((component, index) => Math.abs(component - rightRgb[index]) <= 3)
    && Math.abs(left.v - right.v) <= 1
    && Math.abs(left.a - right.a) <= 1;
}

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
  knobSkin = "auto",
  name,
  rings,
  sensitivity,
  size = ENCODER_MAX_SIZE,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: ColorEncoderProps) {
  const incoming = useMemo(() => normalizeHsva(value), [value]);

  const [internalChannel, setInternalChannel] = useState<ColorEncoderChannel>(
    defaultChannel && channels.includes(defaultChannel) ? defaultChannel : channels[0],
  );
  const channel = activeChannel && channels.includes(activeChannel) ? activeChannel : internalChannel;
  useEffect(() => {
    if (!channels.includes(internalChannel)) {
      setInternalChannel(defaultChannel && channels.includes(defaultChannel) ? defaultChannel : channels[0]);
    }
  }, [channels, defaultChannel, internalChannel]);

  // The dial keeps its own unrounded colour and adopts an incoming one only
  // when it is genuinely different (specs/color-encoder.md, "Rounding"). The
  // base holds the channel being turned through a drag; this ref carries the
  // whole colour, so the other three channels survive the round trip.
  const colourRef = useRef(incoming);
  const pressedRef = useRef(false);
  if (!pressedRef.current && !sameStoredColour(colourRef.current, incoming)) {
    colourRef.current = incoming;
  }
  const colour = colourRef.current;

  const leds: EncoderLed[] = useMemo(
    () => channels.map((item) => ({ id: item, label: CHANNEL_LABEL[item] })),
    [channels],
  );

  const dialSize = clamp(Math.round(size), ENCODER_MIN_SIZE, ENCODER_MAX_SIZE);
  const withAlpha = channels.includes("alpha");
  const rgb = hsvaToRgb(colour);
  const glowAmount = clamp((colour.v - 50) / 50, 0, 1) * (withAlpha ? colour.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

  const current = channelValue(colour, channel);
  const apply = (next: number) => {
    const updated = withChannel(colour, channel, next);
    colourRef.current = updated;
    return updated;
  };

  return (
    <>
      <RotaryEncoder
        variantClassName="color-encoder"
        className={className}
        ariaLabel={ariaLabel ?? (label ? undefined : "Colour")}
        ariaValueText={`${CHANNEL_LABEL[channel]} ${Math.round(current)}${channel === "hue" ? "°" : "%"}`}
        checker
        color={hsvaToCss(withAlpha ? colour : { ...colour, a: 100 })}
        demoTooltip={demoTooltip}
        demoTooltipTitle={demoTooltipTitle}
        disabled={disabled}
        faceTop={label}
        faceBottom={CHANNEL_CAPTION[channel][dialSize < CAPTION_SHORT_BELOW_PX ? 1 : 0]}
        glow={glow}
        knobSkin={knobSkin}
        leds={leds}
        activeLed={channel}
        onActiveLedChange={(id) => {
          setInternalChannel(id as ColorEncoderChannel);
          onActiveChannelChange?.(id as ColorEncoderChannel);
        }}
        range={channel === "hue" ? { min: 0, max: 360, wrap: true } : { min: 0, max: 100 }}
        rings={rings}
        sensitivity={sensitivity?.[channel] ?? SENSITIVITY[channel]}
        size={size}
        value={current}
        onPressedChange={(pressed) => {
          pressedRef.current = pressed;
        }}
        onChange={(next) => onChange(apply(next))}
        onCommit={(next) => onCommit?.(apply(next))}
      />
      {name ? <input type="hidden" name={name} value={hsvaToFormValue(colour, format, withAlpha)} /> : null}
    </>
  );
}
