"use client";

/**
 * ColorEncoder — Nova's rotary colour control (specs/color-encoder.md).
 *
 * One soft dial. A row of lights across its centre says which channel the dial
 * is turning; tapping cycles them. The sunken ring around the dial carries the
 * resulting colour and is the control's *only* readout — there is deliberately
 * no hex code, no RGB triplet and no numeric value anywhere on it.
 *
 * The rotor carries a single index line joined to the knob's rim — no notch;
 * two marks on a knob this soft read as clutter (Adeline, 2026-09-11).
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
import { NOVA_THEME_SET_CHANGE_EVENT } from "./accentColor";
import { selectionHaptic } from "./haptics";
import { TAP_MAX_MS, TAP_MOVE_THRESHOLD_PX } from "./sliderTapGesture";

export type ColorEncoderChannel = "hue" | "brightness" | "saturation" | "alpha";

export const COLOR_ENCODER_CHANNELS: ColorEncoderChannel[] = ["hue", "brightness", "saturation"];
export const COLOR_ENCODER_CHANNELS_WITH_ALPHA: ColorEncoderChannel[] = [
  "hue",
  "brightness",
  "saturation",
  "alpha",
];

export const COLOR_ENCODER_MIN_SIZE = 50;
export const COLOR_ENCODER_MAX_SIZE = 200;

/** Units of channel movement per pixel of signed drag. */
const SENSITIVITY: Record<ColorEncoderChannel, number> = {
  hue: 0.5,
  brightness: 1 / 3,
  saturation: 1 / 3,
  alpha: 1 / 3,
};

/**
 * Where the index points for a 0–100 channel: 0 at 7:30, 100 at 4:30, over the
 * top (Adeline, 2026-09-11). Clockwise degrees from 12 o'clock.
 */
const BOUNDED_ANGLE_START = -135;
const BOUNDED_ANGLE_SPAN = 270;

/**
 * The index angle a channel's value calls for, before any whole turns are
 * added. Hue reads straight off as degrees, so one turn is one trip round the
 * wheel; the rest sweep 7:30 → 12 → 4:30.
 */
function indexAngle(value: Hsva, channel: ColorEncoderChannel) {
  if (channel === "hue") return value.h;
  return BOUNDED_ANGLE_START + (BOUNDED_ANGLE_SPAN * channelValue(value, channel)) / 100;
}

/** `target` plus the whole turns that land it nearest `from`: the short way round. */
function nearestTurn(target: number, from: number) {
  return target + 360 * Math.round((from - target) / 360);
}

/** Shift or Alt makes every channel this much finer. */
const FINE_DIVISOR = 8;

/** Whether a drag ended on the value it started from, click for click. */
function sameHsva(left: Hsva, right: Hsva) {
  return left.h === right.h && left.s === right.s && left.v === right.v && left.a === right.a;
}

/** Keyboard nudge, expressed as the drag distance it stands in for. */
const KEY_STEP_PX = 8;
const KEY_STEP_FINE_PX = 1;

const CHANNEL_LABEL: Record<ColorEncoderChannel, string> = {
  hue: "hue",
  brightness: "brightness",
  saturation: "saturation",
  alpha: "alpha",
};

/**
 * The caption under the lights, in two lengths.
 *
 * The caption's font size is clamped 10-14px, so below the size at which it
 * would fall under 10px there is no more room to give — and a long word starts
 * crowding the lights. Adeline, 2026-09-11: at the smaller size, BRT and ALPH.
 */
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

/**
 * Light or dark, decided from the theme colour the knob is actually painted in.
 *
 * The dashboard's light and dark variants differ only in the values of their
 * CSS custom properties — nothing in the DOM says which is active — so the dial
 * reads its own resolved tint and judges it. That keeps the control
 * self-contained: it works on the config page, inside a design module, and
 * anywhere a caller overrides `--ce-tint` to something of its own.
 */
function isLightSurface(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return false;
  const parsed = window.getComputedStyle(element).color.match(/[\d.]+/g);
  if (!parsed || parsed.length < 3) return false;
  const [r, g, b] = parsed.map(Number);
  // Rec. 709 luma, the same weighting the wallpaper sampler uses.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
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
  /** Which light is lit on load. Defaults to the first channel. */
  defaultChannel?: ColorEncoderChannel;
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
  defaultChannel,
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

  const [internalChannel, setInternalChannel] = useState<ColorEncoderChannel>(
    defaultChannel && channels.includes(defaultChannel) ? defaultChannel : channels[0],
  );
  const channel = activeChannel && channels.includes(activeChannel) ? activeChannel : internalChannel;
  // A caller that narrows `channels` must not leave the dial pointing at a
  // light that is no longer rendered.
  useEffect(() => {
    if (!channels.includes(internalChannel)) {
      setInternalChannel(defaultChannel && channels.includes(defaultChannel) ? defaultChannel : channels[0]);
    }
  }, [channels, defaultChannel, internalChannel]);

  const [pressed, setPressed] = useState(false);
  const [, rerender] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"dark" | "light">("dark");

  // Server and first client render must agree (SPEC.md §2), so the dial starts
  // dark and re-reads its surface after mount and on every theme change.
  useEffect(() => {
    const read = () => setMode(isLightSurface(rootRef.current) ? "light" : "dark");
    read();
    const events = ["nova-accent-change", NOVA_THEME_SET_CHANGE_EVENT, "nova-sun-change"];
    for (const event of events) window.addEventListener(event, read);
    return () => {
      for (const event of events) window.removeEventListener(event, read);
    };
  }, []);

  // The dial keeps its own unrounded value. Callers store integer intensity and
  // rgb, so feeding their rounded echo back into the next nudge would swallow
  // every sub-unit step — a fine drag would never move. The echo is adopted
  // only when it is a genuinely different colour (a preset, a paste, another
  // client), never when it is just our own value rounded.
  const valueRef = useRef(incoming);
  const dragRef = useRef<{ at: number; x: number; y: number; travel: number; start: Hsva } | null>(null);
  // A drag owns the value until it ends. Without this, an echo that arrives
  // mid-turn — a zone reporting a waypoint of a fade, say — is a different
  // colour by the rule above and gets adopted, yanking the dial away from the
  // hand that is turning it. At the top of the brightness range that reads as a
  // blip down to a low value (Adeline, 2026-09-11).
  if (!dragRef.current && !sameStoredColour(valueRef.current, incoming)) {
    valueRef.current = incoming;
  }
  const normalized = valueRef.current;

  // The index shows the active channel's value (specs/color-encoder.md,
  // "Interaction"). The displayed angle is that value's angle plus whole turns,
  // chosen so it never jumps: a channel change re-points the short way round,
  // and hue stays continuous across 360→0 so it turns forever. Within a 0–100
  // channel the turns are held fixed, so a big outside change still sweeps over
  // the top rather than under it.
  const angleRef = useRef<{ angle: number; channel: ColorEncoderChannel; turns: number } | null>(null);
  // Hue turned by our own hand since the last render, unwrapped: a fast flick
  // can pass 180° in one move, which "the short way round" would read backwards.
  const spinRef = useRef(0);
  const target = indexAngle(normalized, channel);
  const previous = angleRef.current;
  let angle = target;
  if (previous && previous.channel === channel && channel === "hue" && spinRef.current !== 0) {
    angle = nearestTurn(target, previous.angle + spinRef.current);
  } else if (previous) {
    angle = previous.channel === channel && channel !== "hue"
      ? target + previous.turns
      : nearestTurn(target, previous.angle);
  }
  spinRef.current = 0;
  angleRef.current = { angle, channel, turns: angle - target };

  const dialSize = clamp(Math.round(size), COLOR_ENCODER_MIN_SIZE, COLOR_ENCODER_MAX_SIZE);
  const withAlpha = channels.includes("alpha");
  const rgb = hsvaToRgb(normalized);

  // Below half brightness the colour is not emitting anything, so no glow at
  // all; from there it ramps to full (specs/color-encoder.md, "Glow").
  const glowAmount = clamp((normalized.v - 50) / 50, 0, 1) * (withAlpha ? normalized.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

  /**
   * `silent` suppresses the click, for a quick tap that already clicked on the
   * way down. Adeline, 2026-09-11: a press and a change are two events and two
   * clicks when they are two gestures, but a tap is one gesture and should
   * sound once. A deliberate press-and-hold still gets both.
   */
  const cycleChannel = (silent = false) => {
    const next = channels[(channels.indexOf(channel) + 1) % channels.length];
    setInternalChannel(next);
    onActiveChannelChange?.(next);
    if (!silent) selectionHaptic();
  };

  const nudge = (pixels: number, fine: boolean) => {
    const rate = (sensitivity?.[channel] ?? SENSITIVITY[channel]) / (fine ? FINE_DIVISOR : 1);
    const current = valueRef.current;
    const next = withChannel(current, channel, channelValue(current, channel) + pixels * rate);
    // Pinned at an end, brightness, saturation and alpha move nothing — so the
    // index, which shows the value, stops too. Hue has no ends.
    if (channel !== "hue" && channelValue(next, channel) === channelValue(current, channel)) return;
    valueRef.current = next;
    if (channel === "hue") spinRef.current += pixels * rate;
    // Re-render for the new ring and index even if the caller ignores the value.
    rerender((count) => count + 1);
    onChange(next);
  };

  const pointerHandlers = disabled
    ? {}
    : {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = typeof performance === "undefined" ? Date.now() : performance.now();
        dragRef.current = { at, x: event.clientX, y: event.clientY, travel: 0, start: valueRef.current };
        setPressed(true);
        // A drag clicks on press and on release, never while turning
        // (Adeline, 2026-09-11: any rate of clicking mid-turn was annoying).
        selectionHaptic();
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
        nudge(dx - dy, event.shiftKey || event.altKey);
      },
      onPointerUp: () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setPressed(false);
        if (!drag) return;
        if (drag.travel < TAP_MOVE_THRESHOLD_PX) {
          const now = typeof performance === "undefined" ? Date.now() : performance.now();
          cycleChannel(now - drag.at < TAP_MAX_MS);
          return;
        }
        // Only if the drag actually moved the value (Adeline, 2026-09-11): a
        // turn that ends where it started, or that only pushed against an end,
        // releases silently.
        if (!sameHsva(drag.start, valueRef.current)) selectionHaptic();
        onCommit?.(valueRef.current);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setPressed(false);
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
      ref={rootRef}
      data-mode={mode}
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
        <span className="color-encoder-channel">
          {CHANNEL_CAPTION[channel][dialSize < CAPTION_SHORT_BELOW_PX ? 1 : 0]}
        </span>
      </div>
      {name ? <input type="hidden" name={name} value={hsvaToFormValue(normalized, format, withAlpha)} /> : null}
    </div>
  );
}
