"use client";

/**
 * RingedColorEncoder — the colour dial with up to five arc sliders around it
 * (specs/color-encoder-rings.md).
 *
 * A copy of `ColorEncoder`, not a wrapper: the two evolve independently, so the
 * dial half of this file and its `.ringed-encoder*` styles are deliberately
 * duplicated. Everything the dial does is specified in specs/color-encoder.md;
 * what differs here is the label, which sits on the knob above the lights, and
 * the concentric slider rings, each a 270° track with a thumb that bends with
 * it and a curved label in the gap at the bottom.
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
} from "./ringedColorEncoderGeometry";

export type RingedColorEncoderChannel = "hue" | "brightness" | "saturation" | "alpha";

export const RINGED_ENCODER_CHANNELS: RingedColorEncoderChannel[] = ["hue", "brightness", "saturation"];
export const RINGED_ENCODER_CHANNELS_WITH_ALPHA: RingedColorEncoderChannel[] = [
  "hue",
  "brightness",
  "saturation",
  "alpha",
];

export const RINGED_ENCODER_MIN_SIZE = 50;
export const RINGED_ENCODER_MAX_SIZE = 200;

/** Units of channel movement per pixel of signed drag. */
const SENSITIVITY: Record<RingedColorEncoderChannel, number> = {
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

function indexAngle(value: Hsva, channel: RingedColorEncoderChannel) {
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
 * press, none while dragging, and one on release only when the drag changed
 * the value. ColorEncoder clicks on every drag release; this copy stays
 * silent when the drag changed nothing.
 */
function sameHsva(left: Hsva, right: Hsva) {
  return left.h === right.h && left.s === right.s && left.v === right.v && left.a === right.a;
}

/** Keyboard nudge, expressed as the drag distance it stands in for. */
const KEY_STEP_PX = 8;
const KEY_STEP_FINE_PX = 1;

const CHANNEL_LABEL: Record<RingedColorEncoderChannel, string> = {
  hue: "hue",
  brightness: "brightness",
  saturation: "saturation",
  alpha: "alpha",
};

const CHANNEL_CAPTION: Record<RingedColorEncoderChannel, [long: string, short: string]> = {
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

function channelValue(value: Hsva, channel: RingedColorEncoderChannel) {
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

function withChannel(value: Hsva, channel: RingedColorEncoderChannel, next: number): Hsva {
  if (channel === "hue") return { ...value, h: wrapHue(next) };
  if (channel === "brightness") return { ...value, v: clamp(next, 0, 100) };
  if (channel === "saturation") return { ...value, s: clamp(next, 0, 100) };
  return { ...value, a: clamp(next, 0, 100) };
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export type RingedColorEncoderRing = {
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

export type RingedColorEncoderProps = {
  activeChannel?: RingedColorEncoderChannel;
  ariaLabel?: string;
  channels?: RingedColorEncoderChannel[];
  className?: string;
  defaultChannel?: RingedColorEncoderChannel;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  format?: "hex" | "rgb";
  /** Shown on the knob, above the lights. */
  label?: string;
  name?: string;
  /** Up to five slider rings, innermost first. */
  rings?: RingedColorEncoderRing[];
  sensitivity?: Partial<Record<RingedColorEncoderChannel, number>>;
  /** Knob diameter in px, clamped to 50–200. */
  size?: number;
  value: Hsva;
  onActiveChannelChange?: (channel: RingedColorEncoderChannel) => void;
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

export function RingedColorEncoder({
  activeChannel,
  ariaLabel,
  channels = RINGED_ENCODER_CHANNELS,
  className,
  defaultChannel,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  format = "hex",
  label,
  name,
  rings = [],
  sensitivity,
  size = RINGED_ENCODER_MAX_SIZE,
  value,
  onActiveChannelChange,
  onChange,
  onCommit,
}: RingedColorEncoderProps) {
  const labelId = useId();
  const ringIdBase = useId();
  const incoming = useMemo(() => normalizeHsva(value), [value]);

  const [internalChannel, setInternalChannel] = useState<RingedColorEncoderChannel>(
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
    const read = () => setMode(isLightSurface(rootRef.current) ? "light" : "dark");
    read();
    const events = ["nova-accent-change", NOVA_THEME_SET_CHANGE_EVENT, "nova-sun-change"];
    for (const event of events) window.addEventListener(event, read);
    return () => {
      for (const event of events) window.removeEventListener(event, read);
    };
  }, []);

  // The dial keeps its own unrounded value and a drag owns it until release —
  // see ColorEncoder and specs/color-encoder.md, "Rounding".
  const valueRef = useRef(incoming);
  const dragRef = useRef<{ at: number; x: number; y: number; travel: number; start: Hsva } | null>(null);
  if (!dragRef.current && !sameStoredColour(valueRef.current, incoming)) {
    valueRef.current = incoming;
  }
  const normalized = valueRef.current;

  const angleRef = useRef<{ angle: number; channel: RingedColorEncoderChannel; turns: number } | null>(null);
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

  const dialSize = clamp(Math.round(size), RINGED_ENCODER_MIN_SIZE, RINGED_ENCODER_MAX_SIZE);
  const withAlpha = channels.includes("alpha");
  const rgb = hsvaToRgb(normalized);

  const glowAmount = clamp((normalized.v - 50) / 50, 0, 1) * (withAlpha ? normalized.a / 100 : 1);
  const glow = glowAmount <= 0
    ? "0 0 0 rgba(0, 0, 0, 0)"
    : `0 0 ${(dialSize * (0.03 + 0.11 * glowAmount)).toFixed(1)}px ${(dialSize * 0.012 * glowAmount).toFixed(1)}px rgba(${rgb.join(", ")}, ${(0.62 * glowAmount).toFixed(3)})`;

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
    const moved = channel === "hue" ? pixels : (channelValue(next, channel) - channelValue(current, channel)) / rate;
    if (moved === 0) return 0;
    valueRef.current = next;
    if (channel === "hue") spinRef.current += pixels * rate;
    rerender((count) => count + 1);
    onChange(next);
    return moved;
  };

  const pointerHandlers = disabled
    ? {}
    : {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { at: now(), x: event.clientX, y: event.clientY, travel: 0, start: valueRef.current };
        setPressed(true);
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
        nudge(dx - dy, event.shiftKey || event.altKey);
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

  // ── Rings ─────────────────────────────────────────────────────────────────

  if (rings.length > RING_LIMIT && process.env.NODE_ENV !== "production") {
    console.warn(`RingedColorEncoder: ${rings.length} rings given, only the first ${RING_LIMIT} are drawn.`);
  }
  const shown = rings.slice(0, RING_LIMIT);
  const geometry = ringGeometry(dialSize, shown.length);
  const centre = geometry.footprint / 2;

  // While a ring is pressed it owns its value, as the dial does: the thumb is
  // drawn from the pointer, not from the caller's (possibly rounded) echo.
  const ringPressRef = useRef<RingPress | null>(null);
  const ringLiveRef = useRef<Record<string, number>>({});

  const ringValue = (ring: RingedColorEncoderRing) => ringLiveRef.current[ring.id] ?? ring.value;
  const ringRange = (ring: RingedColorEncoderRing) => [ring.min ?? 0, ring.max ?? 100] as const;
  const ringDisabled = (ring: RingedColorEncoderRing) => disabled || Boolean(ring.disabled);

  const setRing = (ring: RingedColorEncoderRing, next: number) => {
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

  const ringKeyDown = (ring: RingedColorEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
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

  const ringKeyUp = (ring: RingedColorEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
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
  const labelKey = shown.map((ring) => ring.label).join(" ");
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("class", "ringed-encoder-ring-label ringed-encoder-etch-face");
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
    probe.className = "ringed-encoder-label";
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
      className={["ringed-encoder", disabled ? "ringed-encoder-disabled" : "", className].filter(Boolean).join(" ")}
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
          className="ringed-encoder-rings"
          width={geometry.footprint}
          height={geometry.footprint}
          viewBox={`0 0 ${geometry.footprint} ${geometry.footprint}`}
          {...ringHandlers}
        >
          <defs>
            {/* The colour ring's sunken lighting: dark at the top left, a
                little light at the bottom right. */}
            <linearGradient id={`${ringIdBase}-shade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
              <stop offset="0" className="ringed-encoder-shade-a" />
              <stop offset="0.45" className="ringed-encoder-shade-b" />
              <stop offset="1" className="ringed-encoder-shade-c" />
            </linearGradient>
            <linearGradient id={`${ringIdBase}-lip`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
              <stop offset="0" className="ringed-encoder-lip-a" />
              <stop offset="0.55" className="ringed-encoder-lip-b" />
              <stop offset="1" className="ringed-encoder-lip-c" />
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
                className="ringed-encoder-ring-slider"
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
                <path className="ringed-encoder-focus" d={trackPath} strokeWidth={track + 6} />
                <path className="ringed-encoder-lip" d={trackPath} strokeWidth={track + 2 * Math.max(1, track * 0.18)} stroke={`url(#${ringIdBase}-lip)`} />
                <path className="ringed-encoder-well" d={trackPath} strokeWidth={track} />
                <path className="ringed-encoder-well-shade" d={trackPath} strokeWidth={track} stroke={`url(#${ringIdBase}-shade)`} />
                {/* At the minimum the fill is empty; its round start would
                    otherwise peek out past the thumb. */}
                {fraction > 0 ? (
                  <path className="ringed-encoder-fill" d={arcPath(centre, centre, radius, ARC_START, thumbAt)} strokeWidth={track * 0.6} />
                ) : null}
                <g className="ringed-encoder-thumb">
                  <path className="ringed-encoder-thumb-edge" d={thumbPath} strokeWidth={track * THUMB_THICKNESS + 1} />
                  <path className="ringed-encoder-thumb-body" d={thumbPath} strokeWidth={track * THUMB_THICKNESS} />
                  <path className="ringed-encoder-thumb-crown" d={thumbPath} strokeWidth={track * THUMB_THICKNESS * 0.55} />
                </g>
                {/* Etched like the dial's caption. SVG text takes no
                    text-shadow, so the lip below and the cut above are offset
                    copies drawn under the face. */}
                {(["lip", "cut", "face"] as const).map((layer) => (
                  <text
                    key={layer}
                    className={`ringed-encoder-ring-label ringed-encoder-etch-${layer}`}
                    fontSize={geometry.font}
                    transform={layer === "lip" ? "translate(0 1)" : layer === "cut" ? "translate(0 -1)" : undefined}
                    aria-hidden
                  >
                    <textPath href={`#${ringIdBase}-label-${index}`} startOffset="50%">
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
        className="ringed-encoder-dial"
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
        <span className="ringed-encoder-outer-bevel" aria-hidden />
        <span className="ringed-encoder-glow" aria-hidden />
        <span className="ringed-encoder-checker" aria-hidden />
        <span className="ringed-encoder-ring" aria-hidden />
        <span className="ringed-encoder-ring-shade" aria-hidden />
        <span className="ringed-encoder-inner-bevel" aria-hidden />
        <span className="ringed-encoder-knob" aria-hidden />
        <span className="ringed-encoder-rotor" aria-hidden>
          <span className="ringed-encoder-index" />
        </span>
        <span className="ringed-encoder-spec" aria-hidden />
        {label ? (
          <span className="ringed-encoder-label" id={labelId} aria-label={label}>
            {knobLabel}
          </span>
        ) : null}
        <span className="ringed-encoder-leds" aria-hidden>
          {channels.map((item) => (
            <span
              key={item}
              className="ringed-encoder-led"
              data-lit={item === channel ? "true" : "false"}
              data-channel={item}
            />
          ))}
        </span>
        <span className="ringed-encoder-channel">
          {CHANNEL_CAPTION[channel][dialSize < CAPTION_SHORT_BELOW_PX ? 1 : 0]}
        </span>
      </div>
      {name ? <input type="hidden" name={name} value={hsvaToFormValue(normalized, format, withAlpha)} /> : null}
    </div>
  );
}
