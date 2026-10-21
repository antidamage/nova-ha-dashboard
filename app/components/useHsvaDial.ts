/**
 * The HSVA half of a colour dial, shared by `ColorEncoder` (the picker) and
 * `LightEncoder` (the lights): which channel the knob turns, the unrounded
 * colour it keeps through a drag, and the channel tables
 * (specs/color-encoder.md, "Channels" and "Rounding"; specs/light-encoder.md).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { hsvaToRgb, normalizeHsva, wrapHue, type Hsva } from "./colorEncoderModel";
import { ENCODER_MAX_SIZE, ENCODER_MIN_SIZE, type EncoderLed } from "./RotaryEncoder";
import { ARC_SPAN } from "./rotaryEncoderGeometry";

export type ColorEncoderChannel = "hue" | "brightness" | "saturation" | "alpha";

/**
 * Units of channel movement per degree the knob is turned. The index shows the
 * value, so the value moves at exactly the rate its own index angle implies: a
 * hue degree per degree, and 100/270 of a 0–100 channel per degree.
 */
export const CHANNEL_SENSITIVITY: Record<ColorEncoderChannel, number> = {
  hue: 1,
  brightness: 100 / ARC_SPAN,
  saturation: 100 / ARC_SPAN,
  alpha: 100 / ARC_SPAN,
};

export const CHANNEL_LABEL: Record<ColorEncoderChannel, string> = {
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

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function channelValue(value: Hsva, channel: ColorEncoderChannel) {
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

export function channelCaption(channel: ColorEncoderChannel, dialSize: number) {
  return CHANNEL_CAPTION[channel][dialSize < CAPTION_SHORT_BELOW_PX ? 1 : 0];
}

export function useHsvaDial({
  activeChannel,
  channels,
  defaultChannel,
  size,
  value,
  onActiveChannelChange,
}: {
  activeChannel?: ColorEncoderChannel;
  channels: ColorEncoderChannel[];
  defaultChannel?: ColorEncoderChannel;
  size: number;
  value: Hsva;
  onActiveChannelChange?: (channel: ColorEncoderChannel) => void;
}) {
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

  const apply = (next: number) => {
    const updated = withChannel(colour, channel, next);
    colourRef.current = updated;
    return updated;
  };

  return {
    apply,
    channel,
    colour,
    current: channelValue(colour, channel),
    dialSize: clamp(Math.round(size), ENCODER_MIN_SIZE, ENCODER_MAX_SIZE),
    leds,
    selectChannel: (id: string) => {
      setInternalChannel(id as ColorEncoderChannel);
      onActiveChannelChange?.(id as ColorEncoderChannel);
    },
    setPressed: (pressed: boolean) => {
      pressedRef.current = pressed;
    },
  };
}
