"use client";

/**
 * ColorEncoder — Nova's rotary colour control (specs/color-encoder.md).
 *
 * One soft dial. A row of lights across its centre says which channel the dial
 * is turning; tapping cycles them. The sunken ring around the dial carries the
 * resulting colour and is the control's *only* readout — there is deliberately
 * no hex code, no RGB triplet and no numeric value anywhere on it.
 *
 * Everything scales from `size` (the knob diameter, 50–200px), which is
 * published as `--ce-size` so a caller or a design module can override any
 * derived dimension from CSS without touching this file.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  hsvaToCss,
  hsvaToFormValue,
  hsvaToRgb,
  normalizeHsva,
  wrapHue,
  type Hsva,
} from "./colorEncoderModel";
import { selectionHaptic, SliderHapticController } from "./haptics";
import { TAP_MOVE_THRESHOLD_PX } from "./sliderTapGesture";

export type ColorEncoderChannel = "hue" | "brightness" | "saturation" | "opacity";

export const COLOR_ENCODER_CHANNELS: ColorEncoderChannel[] = ["hue", "brightness", "saturation"];
export const COLOR_ENCODER_CHANNELS_WITH_OPACITY: ColorEncoderChannel[] = [
  "hue",
  "brightness",
  "saturation",
  "opacity",
];

export const COLOR_ENCODER_MIN_SIZE = 50;
export const COLOR_ENCODER_MAX_SIZE = 200;

/** Units of channel movement per pixel of signed drag. */
const SENSITIVITY: Record<ColorEncoderChannel, number> = {
  hue: 0.5,
  brightness: 1 / 3,
  saturation: 1 / 3,
  opacity: 1 / 3,
};

/** Degrees the rotor turns per pixel of signed drag. Visual only. */
const DEGREES_PER_PX = 0.5;

/** Shift or Alt makes every channel this much finer. */
const FINE_DIVISOR = 8;

/** Keyboard nudge, expressed as the drag distance it stands in for. */
const KEY_STEP_PX = 8;
const KEY_STEP_FINE_PX = 1;

const CHANNEL_LABEL: Record<ColorEncoderChannel, string> = {
  hue: "hue",
  brightness: "brightness",
  saturation: "saturation",
  opacity: "opacity",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function channelValue(value: Hsva, channel: ColorEncoderChannel) {
  if (channel === "hue") return value.h;
  if (channel === "brightness") return value.v;
  if (channel === "saturation") return value.s;
  return value.a;
}

/**
 * Whether two values are the same colour to within the rounding the stored
 * shapes apply (integer rgb, integer intensity and opacity). Hue is compared
 * through rgb on purpose: a grey or black carries no hue, so the dial keeps the
 * one it had instead of snapping to red.
 */
function sameStoredColour(left: Hsva, right: Hsva) {
  const leftRgb = hsvaToRgb(left);
  const rightRgb = hsvaToRgb(right);
  return leftRgb.every((component, index) => Math.abs(component - rightRgb[index]) <= 3)
    && Math.abs(left.v - right.v) <= 1
    && Math.abs(left.a - right.a) <= 1;
}

function withChannel(value: Hsva, channel: ColorEncoderChannel, next: number): Hsva {
  if (channel === "hue") return { ...value, h: wrapHue(next) };
  if (channel === "brightness") return { ...value, v: clamp(next, 0, 100) };
  if (channel === "saturation") return { ...value, s: clamp(next, 0, 100) };
  return { ...value, a: clamp(next, 0, 100) };
}

export type ColorEncoderProps = {
  /** Overrides the internal channel state when a caller wants to drive it. */
  activeChannel?: ColorEncoderChannel;
  ariaLabel?: string;
  /** Which lights the dial has, in order. Defaults to hue/brightness/saturation. */
  channels?: ColorEncoderChannel[];
  className?: string;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  /** Form value shape when `name` is set and opacity is full. */
  format?: "hex" | "rgb";
  label?: string;
  /** Renders a hidden input under this name carrying the colour. */
  name?: string;
  /** Per-channel units-per-pixel overrides. */
  sensitivity?: Partial<Record<ColorEncoderChannel, number>>;
  /** Knob diameter in px, clamped to 50–200. */
  size?: number;
  value: Hsva;
  onActiveChannelChange?: (channel: ColorEncoderChannel) => void;
  /** Fires continuously while dragging — the preview boundary. */
  onChange: (value: Hsva) => void;
  /** Fires once per gesture on release — the persistence boundary. */
  onCommit?: (value: Hsva) => void;
};

export function ColorEncoder({
  activeChannel,
  ariaLabel,
  channels = COLOR_ENCODER_CHANNELS,
  className,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  format = "hex",
  label,
  name,
  sensitivity,
  size = COLOR_ENCODER_MAX_SIZE,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: ColorEncoderProps) {
  const labelId = useId();
  const incoming = useMemo(() => normalizeHsva(value), [value]);

  const [internalChannel, setInternalChannel] = useState<ColorEncoderChannel>(channels[0]);
  const channel = activeChannel && channels.includes(activeChannel) ? activeChannel : internalChannel;
  // A caller that narrows `channels` must not leave the dial pointing at a
  // light that is no longer rendered.
  useEffect(() => {
    if (!channels.includes(internalChannel)) setInternalChannel(channels[0]);
  }, [channels, internalChannel]);

  const [angle, setAngle] = useState(0);
  const [pressed, setPressed] = useState(false);

  // The dial keeps its own unrounded value. Callers store integer intensity and
  // rgb, so feeding their rounded echo back into the next nudge would swallow
  // every sub-unit step — a fine drag would never move. The echo is adopted
  // only when it is a genuinely different colour (a preset, a paste, another
  // client), never when it is just our own value rounded.
  const valueRef = useRef(incoming);
  if (!sameStoredColour(valueRef.current, incoming)) valueRef.current = incoming;
  const normalized = valueRef.current;
  const dragRef = useRef<{ x: number; y: number; travel: number } | null>(null);
  const hapticsRef = useRef(new SliderHapticController());

  const dialSize = clamp(Math.round(size), COLOR_ENCODER_MIN_SIZE, COLOR_ENCODER_MAX_SIZE);
  const withAlpha = channels.includes("opacity");
  const rgb = hsvaToRgb(normalized);

  // Below half brightness the colour is not emitting anything, so no glow at
  // all; from there it ramps to full (specs/color-encoder.md, "Glow").
  const glowAmount = clamp((normalized.v - 50) / 50, 0, 1) * (withAlpha ? normalized.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

  const cycleChannel = () => {
    const next = channels[(channels.indexOf(channel) + 1) % channels.length];
    setInternalChannel(next);
    onActiveChannelChange?.(next);
    selectionHaptic();
  };

  const nudge = (pixels: number, fine: boolean) => {
    const rate = (sensitivity?.[channel] ?? SENSITIVITY[channel]) / (fine ? FINE_DIVISOR : 1);
    const current = valueRef.current;
    const next = withChannel(current, channel, channelValue(current, channel) + pixels * rate);
    valueRef.current = next;
    setAngle((previous) => previous + pixels * DEGREES_PER_PX);
    onChange(next);
    return next;
  };

  const pointerHandlers = disabled
    ? {}
    : {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, travel: 0 };
        setPressed(true);
        hapticsRef.current.start({ value: channelValue(valueRef.current, channel) });
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || event.buttons !== 1) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.travel += Math.abs(dx) + Math.abs(dy);
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (dx === 0 && dy === 0) return;
        // Right and up turn the value up, left and down turn it down; a
        // diagonal sums the two.
        const next = nudge(dx - dy, event.shiftKey || event.altKey);
        hapticsRef.current.move(Math.abs(dx - dy) / dialSize, { value: channelValue(next, channel) });
      },
      onPointerUp: () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setPressed(false);
        hapticsRef.current.stop();
        if (!drag) return;
        if (drag.travel < TAP_MOVE_THRESHOLD_PX) {
          cycleChannel();
          return;
        }
        onCommit?.(valueRef.current);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setPressed(false);
        hapticsRef.current.stop();
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? KEY_STEP_FINE_PX : KEY_STEP_PX;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          nudge(step, event.shiftKey);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(-step, event.shiftKey);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cycleChannel();
        }
      },
      onKeyUp: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key.startsWith("Arrow")) onCommit?.(valueRef.current);
      },
    };

  return (
    <div
      className={["color-encoder", disabled ? "color-encoder-disabled" : "", className].filter(Boolean).join(" ")}
      style={{
        "--ce-size": `${dialSize}px`,
        "--ce-color": hsvaToCss(withAlpha ? normalized : { ...normalized, a: 100 }),
        "--ce-glow": glow,
        "--ce-angle": `${angle.toFixed(2)}deg`,
      } as React.CSSProperties}
    >
      {label ? (
        <span className="color-encoder-label" id={labelId}>
          {label}
        </span>
      ) : null}
      <div
        className="color-encoder-dial"
        role="slider"
        aria-label={ariaLabel ?? (label ? undefined : "Colour")}
        aria-labelledby={ariaLabel || !label ? undefined : labelId}
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={channel === "hue" ? 360 : 100}
        aria-valuenow={Math.round(channelValue(normalized, channel))}
        aria-valuetext={`${CHANNEL_LABEL[channel]} ${Math.round(channelValue(normalized, channel))}${channel === "hue" ? "°" : "%"}`}
        data-channel={channel}
        data-pressed={pressed ? "true" : undefined}
        data-demo-tooltip-title={demoTooltipTitle}
        data-demo-tooltip={demoTooltip}
        tabIndex={disabled ? -1 : 0}
        {...pointerHandlers}
      >
        <span className="color-encoder-outer-bevel" aria-hidden />
        <span className="color-encoder-glow" aria-hidden />
        <span className="color-encoder-checker" aria-hidden />
        <span className="color-encoder-ring" aria-hidden />
        <span className="color-encoder-ring-shade" aria-hidden />
        <span className="color-encoder-inner-bevel" aria-hidden />
        <span className="color-encoder-knob" aria-hidden />
        <span className="color-encoder-rotor" aria-hidden>
          <span className="color-encoder-index" />
          <span className="color-encoder-notch" />
        </span>
        <span className="color-encoder-spec" aria-hidden />
        <span className="color-encoder-leds" aria-hidden>
          {channels.map((item) => (
            <span
              key={item}
              className="color-encoder-led"
              data-lit={item === channel ? "true" : "false"}
              data-channel={item}
            />
          ))}
        </span>
      </div>
      {name ? <input type="hidden" name={name} value={hsvaToFormValue(normalized, format, withAlpha)} /> : null}
    </div>
  );
}
