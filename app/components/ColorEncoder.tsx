"use client";

/**
 * ColorEncoder — Nova's rotary colour control (specs/color-encoder.md).
 *
 * One soft dial. A row of lights across its centre says which channel it is
 * turning; tapping cycles them. The sunken ring around the dial carries the
 * resulting colour and is the control's *only* colour readout — no hex, no RGB,
 * no number anywhere on it. The label sits on the knob face above the lights.
 *
 * A dial can carry up to five slider rings outside its colour ring, each a 270°
 * track with a thumb that bends with it and a curved label in the gap at the
 * bottom. `RingedColorEncoder` — the copy these came from — was merged back in
 * on 2026-09-11.
 *
 * The knob turns like a real knob: a drag applies the angle swept about the
 * centre since the last sample, never jumping to meet the pointer. Rings are
 * sliders bent round a circle and do jump to the press.
 *
 * Everything scales from `size` (the knob diameter, 50–200px), published as
 * `--ce-size` so a caller or design module can override any derived dimension
 * from CSS without touching this file.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  ARC_END,
  ARC_START,
  RING_LIMIT,
  THUMB_LENGTH,
  THUMB_THICKNESS,
  arcPath,
  dragStep,
  fractionOf,
  labelPath,
  labelRoom,
  pointerAngle,
  ringAt,
  ringGeometry,
  thumbAngle,
  valueAt,
  type RingDrag,
} from "./colorEncoderGeometry";

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

/**
 * Where the index points for a 0–100 channel: 0 at 7:30, 100 at 4:30, over the
 * top (Adeline, 2026-09-11). Clockwise degrees from 12 o'clock.
 */
const BOUNDED_ANGLE_START = ARC_START;
const BOUNDED_ANGLE_SPAN = ARC_END - ARC_START;

/**
 * Nearer the centre than this share of the knob's radius, a pointer sample is
 * ignored: a pixel of movement there swings the angle wildly.
 */
const DEAD_CENTRE_SHARE = 0.15;

/**
 * Units of channel movement per degree the knob is turned.
 *
 * The index shows the value, so the value moves at exactly the rate its own
 * index angle implies: a hue degree per degree, and 100/270 of a 0–100 channel
 * per degree. The knob then tracks the hand precisely (specs/color-encoder.md,
 * "Interaction").
 */
const SENSITIVITY: Record<ColorEncoderChannel, number> = {
  hue: 1,
  brightness: 100 / BOUNDED_ANGLE_SPAN,
  saturation: 100 / BOUNDED_ANGLE_SPAN,
  alpha: 100 / BOUNDED_ANGLE_SPAN,
};

function indexAngle(value: Hsva, channel: ColorEncoderChannel) {
  if (channel === "hue") return value.h;
  return BOUNDED_ANGLE_START + (BOUNDED_ANGLE_SPAN * channelValue(value, channel)) / 100;
}

/** `target` plus the whole turns that land it nearest `from`: the short way round. */
function nearestTurn(target: number, from: number) {
  return target + 360 * Math.round((from - target) / 360);
}

/** Shift or Alt makes every channel, and every ring, this much finer. */
const FINE_DIVISOR = 8;

/**
 * Clicks, for the dial and every ring alike (Adeline, 2026-09-11): one on
 * press, none while dragging at any rate, and one on release only when the
 * gesture changed the value.
 */
function sameHsva(left: Hsva, right: Hsva) {
  return left.h === right.h && left.s === right.s && left.v === right.v && left.a === right.a;
}

/** Keyboard nudge, in degrees of turn: 5.4° is 2% of a 0–100 channel. */
const KEY_STEP_DEG = 5.4;

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

/**
 * Three periods, not "…": at 10px, letter-spaced and etched, the single glyph
 * reads as a dash, so a cut label looked broken rather than shortened.
 */
const ELLIPSIS = "...";

/** Below this the caption font is pinned at its 10px floor (10 / 0.075). */
const CAPTION_SHORT_BELOW_PX = 10 / 0.075;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Light or dark, from the tint the knob is actually painted in (see ColorEncoder). */
function isLightSurface(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return false;
  const parsed = window.getComputedStyle(element).color.match(/[\d.]+/g);
  if (!parsed || parsed.length < 3) return false;
  const [r, g, b] = parsed.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

function channelValue(value: Hsva, channel: ColorEncoderChannel) {
  if (channel === "hue") return value.h;
  if (channel === "brightness") return value.v;
  if (channel === "saturation") return value.s;
  return value.a;
}

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

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export type ColorEncoderRing = {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  /** Snaps the value; also the keyboard step. */
  step?: number;
  disabled?: boolean;
  /** Fires continuously while dragging — the preview boundary. */
  onChange: (value: number) => void;
  /** Fires once per gesture — the persistence boundary. */
  onCommit?: (value: number) => void;
};

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

type RingPress = {
  index: number;
  drag: RingDrag;
  /** Value before the press, so release can tell whether anything changed. */
  start: number;
  at: number;
  x: number;
  y: number;
  travel: number;
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
  rings = [],
  sensitivity,
  size = COLOR_ENCODER_MAX_SIZE,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: ColorEncoderProps) {
  const labelId = useId();
  const ringIdBase = useId();
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

  const [pressed, setPressed] = useState(false);
  const [, rerender] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    if (knobSkin === "dark" || knobSkin === "light") {
      setMode(knobSkin);
      return;
    }
    const read = () => setMode(isLightSurface(rootRef.current) ? "light" : "dark");
    read();
    const events = ["nova-accent-change", NOVA_THEME_SET_CHANGE_EVENT, "nova-sun-change"];
    for (const event of events) window.addEventListener(event, read);
    return () => {
      for (const event of events) window.removeEventListener(event, read);
    };
  }, [knobSkin]);

  // The dial keeps its own unrounded value and a drag owns it until release —
  // see ColorEncoder and specs/color-encoder.md, "Rounding".
  const valueRef = useRef(incoming);
  const dragRef = useRef<{
    at: number;
    x: number;
    y: number;
    travel: number;
    start: Hsva;
    /** Pointer angle at the last usable sample, or null while too near the centre. */
    angle: number | null;
  } | null>(null);
  if (!dragRef.current && !sameStoredColour(valueRef.current, incoming)) {
    valueRef.current = incoming;
  }
  const normalized = valueRef.current;

  const angleRef = useRef<{ angle: number; channel: ColorEncoderChannel; turns: number } | null>(null);
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

  const glowAmount = clamp((normalized.v - 50) / 50, 0, 1) * (withAlpha ? normalized.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

  /**
   * The pointer's angle about the knob's centre, clockwise from 12 o'clock, or
   * null within the dead centre where the angle would be noise.
   */
  const knobAngle = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return null;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    // The dial element is the knob plus its ring and bevel (--ce-outer, 1.244
    // knob diameters), so the knob's own radius is that over 1.244, halved.
    const knobRadius = rect.width / 1.244 / 2;
    if (Math.hypot(dx, dy) < knobRadius * DEAD_CENTRE_SHARE) return null;
    return pointerAngle(dx, dy);
  };

  const cycleChannel = (silent = false) => {
    const next = channels[(channels.indexOf(channel) + 1) % channels.length];
    setInternalChannel(next);
    onActiveChannelChange?.(next);
    if (!silent) selectionHaptic();
  };

  /** Turns the knob by `degrees`, the signed angle the hand has swept. */
  const nudge = (degrees: number, fine: boolean) => {
    const rate = (sensitivity?.[channel] ?? SENSITIVITY[channel]) / (fine ? FINE_DIVISOR : 1);
    const current = valueRef.current;
    const next = withChannel(current, channel, channelValue(current, channel) + degrees * rate);
    // Pinned at an end, brightness, saturation and alpha move nothing — so the
    // index, which shows the value, stops too. Hue has no ends.
    if (channel !== "hue" && channelValue(next, channel) === channelValue(current, channel)) return;
    valueRef.current = next;
    if (channel === "hue") spinRef.current += degrees * rate;
    // Re-render for the new ring and index even if the caller ignores the value.
    rerender((count) => count + 1);
    onChange(next);
  };

  const pointerHandlers = disabled
    ? {}
    : {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          at: now(),
          x: event.clientX,
          y: event.clientY,
          travel: 0,
          start: valueRef.current,
          angle: knobAngle(event),
        };
        setPressed(true);
        selectionHaptic();
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || event.buttons !== 1) return;
        drag.travel += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        // The knob turns by the angle the hand has swept since the last sample,
        // taken the short way round so crossing 12 o'clock is a small move and
        // not a whole turn. Too near the centre to have a meaningful angle, the
        // sample is dropped and the previous one stands.
        const at = knobAngle(event);
        if (at === null) return;
        if (drag.angle === null) {
          drag.angle = at;
          return;
        }
        const swept = ((at - drag.angle + 540) % 360) - 180;
        drag.angle = at;
        if (swept === 0) return;
        nudge(swept, event.shiftKey || event.altKey);
      },
      onPointerUp: () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setPressed(false);
        if (!drag) return;
        if (drag.travel < TAP_MOVE_THRESHOLD_PX) {
          cycleChannel(now() - drag.at < TAP_MAX_MS);
          return;
        }
        if (!sameHsva(drag.start, valueRef.current)) selectionHaptic();
        onCommit?.(valueRef.current);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setPressed(false);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          nudge(KEY_STEP_DEG, event.shiftKey);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(-KEY_STEP_DEG, event.shiftKey);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cycleChannel();
        }
      },
      onKeyUp: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key.startsWith("Arrow")) onCommit?.(valueRef.current);
      },
    };

  // ── Rings ─────────────────────────────────────────────────────────────────

  if (rings.length > RING_LIMIT && process.env.NODE_ENV !== "production") {
    console.warn(`ColorEncoder: ${rings.length} rings given, only the first ${RING_LIMIT} are drawn.`);
  }
  const shown = rings.slice(0, RING_LIMIT);
  const geometry = ringGeometry(dialSize, shown.length);
  const centre = geometry.footprint / 2;

  // While a ring is pressed it owns its value, as the dial does: the thumb is
  // drawn from the pointer, not from the caller's (possibly rounded) echo.
  const ringPressRef = useRef<RingPress | null>(null);
  const ringLiveRef = useRef<Record<string, number>>({});

  const ringValue = (ring: ColorEncoderRing) => ringLiveRef.current[ring.id] ?? ring.value;
  const ringRange = (ring: ColorEncoderRing) => [ring.min ?? 0, ring.max ?? 100] as const;
  const ringDisabled = (ring: ColorEncoderRing) => disabled || Boolean(ring.disabled);

  const setRing = (ring: ColorEncoderRing, next: number) => {
    const [min, max] = ringRange(ring);
    const bounded = clamp(next, Math.min(min, max), Math.max(min, max));
    if (bounded === ringValue(ring)) return false;
    ringLiveRef.current[ring.id] = bounded;
    rerender((count) => count + 1);
    ring.onChange(bounded);
    return true;
  };

  const locate = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The SVG is drawn at footprint px; a CSS transform may scale it.
    const scale = rect.width > 0 ? geometry.footprint / rect.width : 1;
    const dx = (event.clientX - (rect.left + rect.width / 2)) * scale;
    const dy = (event.clientY - (rect.top + rect.height / 2)) * scale;
    return { distance: Math.hypot(dx, dy), angle: pointerAngle(dx, dy) };
  };

  const applyRingAngle = (press: RingPress, angleAt: number) => {
    const ring = shown[press.index];
    const [min, max] = ringRange(ring);
    const half = geometry.thumbHalfAngle[press.index];
    press.drag = dragStep(press.drag, angleAt, half);
    return setRing(ring, valueAt(press.drag.t, min, max, ring.step));
  };

  const ringHandlers = {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
      const { distance, angle: at } = locate(event);
      const index = ringAt(geometry, distance);
      if (index === null || at < ARC_START || at > ARC_END) return;
      const ring = shown[index];
      if (ringDisabled(ring)) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const [min, max] = ringRange(ring);
      const press: RingPress = {
        index,
        drag: { pinned: null, t: fractionOf(ring.value, min, max) },
        start: ring.value,
        at: now(),
        x: event.clientX,
        y: event.clientY,
        travel: 0,
      };
      ringPressRef.current = press;
      ringLiveRef.current[ring.id] = ring.value;
      selectionHaptic();
      // A tap on the track jumps the thumb there.
      applyRingAngle(press, at);
      (event.currentTarget.querySelector(`[data-ring-index="${index}"]`) as SVGElement | null)?.focus?.({ preventScroll: true });
    },
    onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
      const press = ringPressRef.current;
      if (!press || event.buttons !== 1) return;
      press.travel += Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y);
      press.x = event.clientX;
      press.y = event.clientY;
      applyRingAngle(press, locate(event).angle);
    },
    onPointerUp: () => {
      const press = ringPressRef.current;
      ringPressRef.current = null;
      if (!press) return;
      const ring = shown[press.index];
      const final = ringValue(ring);
      delete ringLiveRef.current[ring.id];
      // A quick tap that jumped the thumb is one gesture and clicks once, as a
      // tap on the dial does; a drag or a held press clicks again on release
      // if it changed the value.
      const tap = press.travel < TAP_MOVE_THRESHOLD_PX && now() - press.at < TAP_MAX_MS;
      if (!tap && final !== press.start) selectionHaptic();
      ring.onCommit?.(final);
    },
    onPointerCancel: () => {
      const press = ringPressRef.current;
      ringPressRef.current = null;
      if (press) delete ringLiveRef.current[shown[press.index].id];
      rerender((count) => count + 1);
    },
  };

  const ringKeyDown = (ring: ColorEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (ringDisabled(ring)) return;
    const [min, max] = ringRange(ring);
    // With a step, Shift cannot go finer than it: the value would snap back.
    const base = ring.step ?? Math.abs(max - min) / 100;
    const step = event.shiftKey && !ring.step ? base / FINE_DIVISOR : base;
    let direction = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") direction = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") direction = -1;
    if (direction === 0) return;
    event.preventDefault();
    const current = ringValue(ring);
    const next = ring.step ? valueAt(fractionOf(current + direction * step, min, max), min, max, ring.step) : current + direction * step;
    ringLiveRef.current[ring.id] = current;
    setRing(ring, next);
  };

  const ringKeyUp = (ring: ColorEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    const final = ringValue(ring);
    delete ringLiveRef.current[ring.id];
    if (!ringDisabled(ring)) ring.onCommit?.(final);
  };

  // Labels longer than their gap are ellipsised, which needs the rendered
  // width — so they are measured after layout, on a throwaway <text> carrying
  // the same class and size, never on the nodes React owns.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [fitted, setFitted] = useState<string[]>([]);
  const labelKey = shown.map((ring) => ring.label).join("\u0000");
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("class", "color-encoder-ring-label color-encoder-etch-face");
    probe.setAttribute("font-size", String(geometry.font));
    probe.setAttribute("visibility", "hidden");
    svg.appendChild(probe);
    const width = (text: string) => {
      probe.textContent = text;
      return typeof probe.getComputedTextLength === "function" ? probe.getComputedTextLength() : 0;
    };
    const next = shown.map((ring, index) => {
      const full = ring.label.toUpperCase();
      const room = labelRoom(geometry, index);
      if (width(full) <= room) return full;
      for (let keep = full.length - 1; keep > 0; keep -= 1) {
        const cut = `${full.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (width(cut) <= room) return cut;
      }
      return ELLIPSIS;
    });
    probe.remove();
    setFitted((current) => (current.length === next.length && current.every((item, index) => item === next[index]) ? current : next));
    // geometry derives from dialSize and the ring count alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, dialSize, shown.length]);

  // The knob label is cut the same way, against its max-width, on a probe
  // carrying the label's class inside the dial.
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [knobLabel, setKnobLabel] = useState(label ?? "");
  useLayoutEffect(() => {
    const host = dialRef.current;
    if (!label || !host) {
      setKnobLabel(label ?? "");
      return;
    }
    const probe = document.createElement("span");
    probe.className = "color-encoder-label";
    probe.style.visibility = "hidden";
    probe.style.maxWidth = "none";
    host.appendChild(probe);
    const room = dialSize * 0.7;
    const fits = (text: string) => {
      probe.textContent = text;
      // jsdom lays nothing out; there, everything fits.
      return probe.getBoundingClientRect().width <= room;
    };
    let next = label;
    if (!fits(label)) {
      next = ELLIPSIS;
      for (let keep = label.length - 1; keep > 0; keep -= 1) {
        const cut = `${label.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (fits(cut)) {
          next = cut;
          break;
        }
      }
    }
    probe.remove();
    setKnobLabel(next);
  }, [label, dialSize]);

  const track = geometry.track;

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
        "--rce-pitch": `${geometry.pitch.toFixed(2)}px`,
        "--rce-track": `${track.toFixed(2)}px`,
        "--rce-rings": String(shown.length),
        "--rce-footprint": `${geometry.footprint.toFixed(2)}px`,
        "--rce-font": `${geometry.font.toFixed(2)}px`,
      } as React.CSSProperties}
    >
      {shown.length > 0 ? (
        <svg
          ref={svgRef}
          className="color-encoder-rings"
          width={geometry.footprint}
          height={geometry.footprint}
          viewBox={`0 0 ${geometry.footprint} ${geometry.footprint}`}
          {...ringHandlers}
        >
          <defs>
            {/* The colour ring's sunken lighting: dark at the top left, a
                little light at the bottom right. */}
            <linearGradient id={`${ringIdBase}-shade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
              <stop offset="0" className="color-encoder-shade-a" />
              <stop offset="0.45" className="color-encoder-shade-b" />
              <stop offset="1" className="color-encoder-shade-c" />
            </linearGradient>
            <linearGradient id={`${ringIdBase}-lip`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
              <stop offset="0" className="color-encoder-lip-a" />
              <stop offset="0.55" className="color-encoder-lip-b" />
              <stop offset="1" className="color-encoder-lip-c" />
            </linearGradient>
            {shown.map((ring, index) => (
              <path key={ring.id} id={`${ringIdBase}-label-${index}`} d={labelPath(centre, centre, geometry.radii[index])} />
            ))}
          </defs>
          {shown.map((ring, index) => {
            const radius = geometry.radii[index];
            const half = geometry.thumbHalfAngle[index];
            const [min, max] = ringRange(ring);
            const current = ringValue(ring);
            const thumbAt = thumbAngle(fractionOf(current, min, max), half);
            const labelText = fitted[index] ?? ring.label.toUpperCase();
            const trackPath = arcPath(centre, centre, radius, ARC_START, ARC_END);
            // The path between the thumb's round ends: its visible length is
            // THUMB_LENGTH tracks, of which the two caps take THUMB_THICKNESS.
            const thumbCore = ((THUMB_LENGTH - THUMB_THICKNESS) * track) / 2 / radius * (180 / Math.PI);
            const thumbPath = arcPath(centre, centre, radius, thumbAt - thumbCore, thumbAt + thumbCore);
            const fraction = fractionOf(current, min, max);
            const off = ringDisabled(ring);
            return (
              <g
                key={ring.id}
                className="color-encoder-ring-slider"
                data-ring-index={index}
                data-ring-id={ring.id}
                data-disabled={off ? "true" : undefined}
                role="slider"
                tabIndex={off ? -1 : 0}
                aria-label={ring.label}
                aria-disabled={off}
                aria-valuemin={Math.min(min, max)}
                aria-valuemax={Math.max(min, max)}
                aria-valuenow={Math.round(current * 100) / 100}
                onKeyDown={ringKeyDown(ring)}
                onKeyUp={ringKeyUp(ring)}
              >
                <path className="color-encoder-focus" d={trackPath} strokeWidth={track + 6} />
                <path className="color-encoder-lip" d={trackPath} strokeWidth={track + 2 * Math.max(1, track * 0.18)} stroke={`url(#${ringIdBase}-lip)`} />
                <path className="color-encoder-well" d={trackPath} strokeWidth={track} />
                <path className="color-encoder-well-shade" d={trackPath} strokeWidth={track} stroke={`url(#${ringIdBase}-shade)`} />
                {/* At the minimum the fill is empty; its round start would
                    otherwise peek out past the thumb. */}
                {fraction > 0 ? (
                  <path className="color-encoder-fill" d={arcPath(centre, centre, radius, ARC_START, thumbAt)} strokeWidth={track * 0.6} />
                ) : null}
                <g className="color-encoder-thumb">
                  <path className="color-encoder-thumb-edge" d={thumbPath} strokeWidth={track * THUMB_THICKNESS + 1} />
                  <path className="color-encoder-thumb-body" d={thumbPath} strokeWidth={track * THUMB_THICKNESS} />
                  <path className="color-encoder-thumb-crown" d={thumbPath} strokeWidth={track * THUMB_THICKNESS * 0.55} />
                </g>
                {/* Etched like the dial's caption. SVG text takes no
                    text-shadow, so the lip below and the cut above are offset
                    copies drawn under the face. */}
                {(["lip", "cut", "face"] as const).map((layer) => (
                  <text
                    key={layer}
                    className={`color-encoder-ring-label color-encoder-etch-${layer}`}
                    fontSize={geometry.font}
                    transform={layer === "lip" ? "translate(0 1)" : layer === "cut" ? "translate(0 -1)" : undefined}
                    aria-hidden
                  >
                    {/* Left-aligned to where the ring's track starts, at 7:30,
                        so every ring's label begins on the same radius
                        (Adeline, 2026-09-11), rather than centred on 6. */}
                    <textPath href={`#${ringIdBase}-label-${index}`} startOffset={geometry.track}>
                      {labelText}
                    </textPath>
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      ) : null}
      <div
        ref={dialRef}
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
        {label ? (
          <span className="color-encoder-label" id={labelId} aria-label={label}>
            {knobLabel}
          </span>
        ) : null}
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
