"use client";

/**
 * RotaryEncoder — the dial every Nova knob is built on (specs/color-encoder.md,
 * "The shared base").
 *
 * One soft dial. A row of lights across its centre says which of the caller's
 * channels, modes or settings it is on; tapping cycles them. Around it is a
 * sunken ring the caller paints, and outside that up to five arc slider rings.
 * The knob turns like a real knob: a drag applies the angle swept about the
 * centre since the last sample, never jumping to meet the pointer. Rings are
 * sliders bent round a circle and do jump to the press.
 *
 * It knows nothing about colour or temperature: a caller supplies the LEDs, the
 * face text, the ring paint, the glow and the value's domain. `ColorEncoder`
 * and `TemperatureEncoder` are the two wrappers.
 *
 * Everything scales from `size` (the knob diameter), published as `--re-size` so
 * a caller or design module can override any derived dimension from CSS.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { NOVA_THEME_SET_CHANGE_EVENT } from "./accentColor";
import { selectionHaptic } from "./haptics";
import { TAP_MAX_MS, TAP_MOVE_THRESHOLD_PX } from "./sliderTapGesture";
import {
  ARC_END,
  ARC_START,
  ARC_SPAN,
  RING_LIMIT,
  THUMB_LENGTH,
  THUMB_THICKNESS,
  arcPath,
  dragStep,
  fractionOf,
  gapLength,
  labelPath,
  labelRoom,
  pointerAngle,
  ringAt,
  ringEndFor,
  ringGeometry,
  thumbAngle,
  valueAt,
  type RingDrag,
} from "./rotaryEncoderGeometry";

export const ENCODER_MIN_SIZE = 50;
export const ENCODER_MAX_SIZE = 200;

/** Nearer the centre than this share of the knob's radius, a sample is noise. */
const DEAD_CENTRE_SHARE = 0.15;

/** Shift or Alt makes every channel, and every ring, this much finer. */
const FINE_DIVISOR = 8;

/** Keyboard nudge, in degrees of turn: 5.4° is 2% of a 270° sweep. */
const KEY_STEP_DEG = 5.4;

/**
 * Three periods, not "…": at 10px, letter-spaced and etched, the single glyph
 * reads as a dash, so a cut label looked broken rather than shortened.
 */
const ELLIPSIS = "...";

/** Tuck-away timings (specs/color-encoder.md, "Tuck-away"). */
export const TUCK_RING_MS = 450;
export const TUCK_RING_STAGGER_MS = 150;
/** The unlocking tap's press must last between these, so a brush never opens it. */
export const UNLOCK_MIN_MS = 60;
export const UNLOCK_MAX_MS = TAP_MAX_MS;
/** Fades a toggle ring's fill in and out. */
export const TOGGLE_FADE_MS = 500;

export type EncoderLed = {
  id: string;
  /** Spoken name for the value the light selects. */
  label: string;
  /** A light the tap cycle steps over (an unsupported mode, say). */
  skip?: boolean;
};

export type EncoderRange = {
  min: number;
  max: number;
  step?: number;
  /** No ends: the value wraps and the knob turns forever (hue). */
  wrap?: boolean;
};

export type RotaryEncoderRingKind = "slider" | "selector" | "toggle";

export type RotaryEncoderRing = {
  id: string;
  label: string;
  kind?: RotaryEncoderRingKind;
  value: number;
  min?: number;
  max?: number;
  /** Snaps the value; also the keyboard step. Selectors always step by 1. */
  step?: number;
  disabled?: boolean;
  /**
   * Drawn right-aligned at the ring's end. Omitted rings show their label only.
   * Pass a function to have the reading follow the thumb through a drag: it is
   * called with the ring's live value, so the text keeps up without the caller
   * hearing about — or sending — anything before the release. Give
   * `valueTextWidest` alongside it, or the ring's length will jump as the
   * reading changes.
   */
  valueText?: string | ((value: number) => string);
  /** The widest value this ring can ever show, so its length never jumps. */
  valueTextWidest?: string;
  /** Never shortened and never carries a value: the stops stay symmetric. */
  symmetric?: boolean;
  /** `selector` and `toggle`: the whole track's fill, or null for an empty well. */
  fill?: string | null;
  /** Fires continuously while dragging — the preview boundary. */
  onChange: (value: number) => void;
  /** Fires once per gesture — the persistence boundary. */
  onCommit?: (value: number) => void;
};

export type RotaryEncoderProps = {
  ariaLabel?: string;
  ariaValueText?: string;
  className?: string;
  /** Extra class on the root, for a wrapper's own CSS. */
  variantClassName?: string;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  /** Lights across the knob's centre; a tap cycles them. */
  leds: EncoderLed[];
  activeLed?: string;
  defaultLed?: string;
  onActiveLedChange?: (id: string) => void;
  /** Text on the knob above the lights. Cut with "..." to fit. */
  faceTop?: string;
  /** Text on the knob below the lights. */
  faceBottom?: string;
  /** Extra classes for those two slots. */
  faceTopClassName?: string;
  faceBottomClassName?: string;
  /** The value's colour: the ring's default paint, its fill and its glow. */
  color?: string;
  /** Paints the colour ring with something richer than `color` (a gradient). */
  ringPaint?: string;
  /** Draws the alpha checkerboard under the ring paint. */
  checker?: boolean;
  /** The ring's glow, as a box-shadow. */
  glow?: string;
  knobSkin?: "auto" | "dark" | "light";
  /**
   * Names every light underneath it, silkscreen fashion, etched like the
   * caption. For a dial whose lights are a set of modes you pick between, where
   * the colour knob's single caption — which only ever names the lit one — is
   * not enough (Adeline, 2026-09-12).
   */
  ledLabels?: boolean;
  /** Up to five slider rings, innermost first. */
  rings?: RotaryEncoderRing[];
  /** Units of value per degree turned. Defaults to the range over its sweep. */
  sensitivity?: number;
  /** Knob diameter in px, clamped to `minSize`–200. */
  size?: number;
  minSize?: number;
  value: number;
  range: EncoderRange;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  /** Whether a pointer is down on the knob: a wrapper holding its own value
   *  needs this to know when a drag owns it. */
  onPressedChange?: (pressed: boolean) => void;
  /** Locks the dial after this long without input, and floats its rings. */
  tuckAfterMs?: number;
  onLockChange?: (locked: boolean) => void;
  /** Extra nodes inside the dial, above the knob face (a wrapper's own layers). */
  children?: ReactNode;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** `target` plus the whole turns that land it nearest `from`: the short way round. */
function nearestTurn(target: number, from: number) {
  return target + 360 * Math.round((from - target) / 360);
}

/** Light or dark, from the tint the knob is actually painted in. */
function isLightSurface(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return false;
  const parsed = window.getComputedStyle(element).color.match(/[\d.]+/g);
  if (!parsed || parsed.length < 3) return false;
  const [r, g, b] = parsed.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/** An evenodd clip that keeps the ring annulus and drops the knob's disc. */
function annulusClip(footprint: number, holeRadius: number) {
  const c = footprint / 2;
  const ring = (radius: number) =>
    `M ${c - radius} ${c} A ${radius} ${radius} 0 1 0 ${c + radius} ${c} A ${radius} ${radius} 0 1 0 ${c - radius} ${c} Z`;
  return `path(evenodd, "${ring(c)} ${ring(holeRadius)}")`;
}

export function RotaryEncoder({
  ariaLabel,
  ariaValueText,
  className,
  variantClassName,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  leds,
  activeLed,
  defaultLed,
  onActiveLedChange,
  faceTop,
  faceBottom,
  faceTopClassName,
  faceBottomClassName,
  color,
  ringPaint,
  checker = false,
  glow,
  knobSkin = "auto",
  ledLabels = false,
  rings = [],
  sensitivity,
  size = ENCODER_MAX_SIZE,
  minSize = ENCODER_MIN_SIZE,
  value,
  range,
  onChange,
  onCommit,
  onPressedChange,
  tuckAfterMs,
  onLockChange,
  children,
}: RotaryEncoderProps) {
  const labelId = useId();
  const ringIdBase = useId();
  const span = range.max - range.min;

  const [internalLed, setInternalLed] = useState<string>(
    defaultLed && leds.some((led) => led.id === defaultLed) ? defaultLed : leds[0]?.id,
  );
  const led = activeLed && leds.some((item) => item.id === activeLed) ? activeLed : internalLed;
  useEffect(() => {
    if (!leds.some((item) => item.id === internalLed)) {
      setInternalLed(defaultLed && leds.some((item) => item.id === defaultLed) ? defaultLed : leds[0]?.id);
    }
  }, [leds, defaultLed, internalLed]);

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

  // The dial keeps its own unrounded value, and a drag owns it until release
  // (specs/color-encoder.md, "Rounding").
  const valueRef = useRef(value);
  const dragRef = useRef<{
    at: number;
    x: number;
    y: number;
    travel: number;
    start: number;
    /** Pointer angle at the last usable sample, or null while too near the centre. */
    angle: number | null;
  } | null>(null);
  if (!dragRef.current && valueRef.current !== value) {
    valueRef.current = value;
  }
  const current = valueRef.current;

  /**
   * The value rounded to the caller's step. The dial accumulates a turn
   * unrounded so small movements still add up across a detent, but everything
   * outside this component — the reading on the face, the index, and the value
   * the caller is handed — sees the stepped value, and only when it actually
   * changes. Without this a 0.5 step still read out in hundredths mid-drag,
   * because the rounding only happened on release (Adeline, 2026-09-12).
   */
  const snapped = (item: number) => (range.step ? Math.round(item / range.step) * range.step : item);
  const detented = snapped(current);

  // ── Tuck-away ─────────────────────────────────────────────────────────────

  const tuckable = typeof tuckAfterMs === "number";
  const [locked, setLocked] = useState(tuckable);
  const [showRings, setShowRings] = useState(!tuckable);
  const [lastInput, setLastInput] = useState(0);
  const noteInput = useCallback(() => setLastInput(now()), []);

  useEffect(() => {
    if (!tuckable) return;
    onLockChange?.(locked);
  }, [locked, onLockChange, tuckable]);

  // Rings stay mounted through the collapse so it can be watched; they only
  // leave the tree once the outermost has finished.
  const ringCount = Math.min(rings.length, RING_LIMIT);
  const collapseMs = TUCK_RING_MS + Math.max(0, ringCount - 1) * TUCK_RING_STAGGER_MS;
  // A ring layer that has fully left the tree remounts with its target style
  // already applied, so there is nothing for the CSS transition to animate
  // from — it would pop straight in. `entering` holds it at the tucked style
  // for one frame after remount, so the very next frame's flip to the open
  // style is a real transition, not a jump.
  const [entering, setEntering] = useState(false);
  const wasShowingRingsRef = useRef(showRings);
  useEffect(() => {
    if (!tuckable) return;
    if (!locked) {
      if (!wasShowingRingsRef.current) setEntering(true);
      wasShowingRingsRef.current = true;
      setShowRings(true);
      return;
    }
    wasShowingRingsRef.current = false;
    const timer = window.setTimeout(() => setShowRings(false), collapseMs);
    return () => window.clearTimeout(timer);
  }, [collapseMs, locked, tuckable]);

  // Two frames, not one: a single rAF callback still runs before the browser
  // has painted the tucked style, so the two style values coalesce and nothing
  // animates. The second frame guarantees the start state was painted.
  useEffect(() => {
    if (!entering) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [entering]);

  // Locks itself after a quiet spell. A pointer held down is not quiet.
  useEffect(() => {
    if (!tuckable || locked || pressed) return;
    const timer = window.setTimeout(() => setLocked(true), tuckAfterMs);
    return () => window.clearTimeout(timer);
  }, [lastInput, locked, pressed, tuckAfterMs, tuckable]);

  // A tap anywhere else locks it at once, and still reaches what it landed on.
  const ringLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tuckable || locked) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || ringLayerRef.current?.contains(target)) return;
      setLocked(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [locked, tuckable]);

  const unlock = () => {
    setLocked(false);
    noteInput();
  };

  // ── The index ─────────────────────────────────────────────────────────────

  const indexAngle = (item: number) => {
    if (span === 0) return ARC_START;
    const fraction = (item - range.min) / span;
    return range.wrap ? fraction * 360 : ARC_START + ARC_SPAN * fraction;
  };

  const angleRef = useRef<{ angle: number; led: string; turns: number } | null>(null);
  const spinRef = useRef(0);
  const target = indexAngle(detented);
  const previous = angleRef.current;
  let angle = target;
  if (previous && previous.led === led && range.wrap && spinRef.current !== 0) {
    angle = nearestTurn(target, previous.angle + spinRef.current);
  } else if (previous) {
    angle = previous.led === led && !range.wrap
      ? target + previous.turns
      : nearestTurn(target, previous.angle);
  }
  spinRef.current = 0;
  angleRef.current = { angle, led, turns: angle - target };

  const dialSize = clamp(Math.round(size), minSize, ENCODER_MAX_SIZE);

  /**
   * The pointer's angle about the knob's centre, clockwise from 12 o'clock, or
   * null within the dead centre where the angle would be noise.
   */
  const knobAngle = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return null;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    // The dial element is the knob plus its ring and bevel (--re-outer, 1.244
    // knob diameters), so the knob's own radius is that over 1.244, halved.
    const knobRadius = rect.width / 1.244 / 2;
    if (Math.hypot(dx, dy) < knobRadius * DEAD_CENTRE_SHARE) return null;
    return pointerAngle(dx, dy);
  };

  const cycleLed = (silent = false) => {
    if (leds.length < 2) return;
    let next = leds.findIndex((item) => item.id === led);
    for (let step = 1; step <= leds.length; step += 1) {
      const candidate = leds[(next + step) % leds.length];
      if (!candidate.skip) {
        next = leds.indexOf(candidate);
        break;
      }
    }
    const id = leds[next].id;
    if (id === led) return;
    setInternalLed(id);
    onActiveLedChange?.(id);
    if (!silent) selectionHaptic();
  };

  const withValue = (next: number) => {
    if (!range.wrap) return clamp(next, range.min, range.max);
    if (span === 0) return range.min;
    return range.min + (((next - range.min) % span) + span) % span;
  };

  const rate = sensitivity ?? (span === 0 ? 0 : span / (range.wrap ? 360 : ARC_SPAN));

  /** Turns the knob by `degrees`, the signed angle the hand has swept. */
  const nudge = (degrees: number, fine: boolean) => {
    const applied = (rate / (fine ? FINE_DIVISOR : 1)) * degrees;
    const from = valueRef.current;
    const next = withValue(from + applied);
    // Pinned at an end, a bounded value moves nothing — so the index, which
    // shows the value, stops too.
    if (!range.wrap && next === from) return;
    const before = snapped(from);
    valueRef.current = next;
    if (range.wrap) spinRef.current += applied * (360 / (span || 360));
    // Re-render for the new ring and index even if the caller ignores the value.
    rerender((count) => count + 1);
    noteInput();
    // A stepped dial only speaks when it crosses a detent; an unstepped one
    // reports every sample, as it always did.
    const after = snapped(next);
    if (range.step && after === before) return;
    onChange(after);
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
        onPressedChange?.(true);
        if (!locked) selectionHaptic();
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || event.buttons !== 1) return;
        drag.travel += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (locked) return;
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
        onPressedChange?.(false);
        if (!drag) return;
        const held = now() - drag.at;
        if (locked) {
          // One deliberate tap opens it: a drag, a brush or a long hold does not.
          if (drag.travel < TAP_MOVE_THRESHOLD_PX && held >= UNLOCK_MIN_MS && held <= UNLOCK_MAX_MS) {
            selectionHaptic();
            unlock();
          }
          return;
        }
        noteInput();
        if (drag.travel < TAP_MOVE_THRESHOLD_PX) {
          cycleLed(held < TAP_MAX_MS);
          return;
        }
        const settled = snapped(valueRef.current);
        if (settled !== valueRef.current) {
          valueRef.current = settled;
          onChange(settled);
        }
        if (settled !== drag.start) selectionHaptic();
        onCommit?.(settled);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setPressed(false);
        onPressedChange?.(false);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
          if (tuckable && !locked) {
            event.preventDefault();
            setLocked(true);
          }
          return;
        }
        if (locked) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            unlock();
          }
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          nudge(KEY_STEP_DEG, event.shiftKey);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(-KEY_STEP_DEG, event.shiftKey);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          noteInput();
          cycleLed();
        }
      },
      onKeyUp: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (locked || !event.key.startsWith("Arrow")) return;
        const settled = snapped(valueRef.current);
        if (settled !== valueRef.current) {
          valueRef.current = settled;
          onChange(settled);
        }
        onCommit?.(settled);
      },
    };

  // ── Rings ─────────────────────────────────────────────────────────────────

  if (rings.length > RING_LIMIT && process.env.NODE_ENV !== "production") {
    console.warn(`RotaryEncoder: ${rings.length} rings given, only the first ${RING_LIMIT} are drawn.`);
  }
  const shown = useMemo(() => rings.slice(0, RING_LIMIT), [rings]);
  const geometry = ringGeometry(dialSize, shown.length);
  const centre = geometry.footprint / 2;
  const track = geometry.track;

  // While a ring is pressed it owns its value, as the dial does: the thumb is
  // drawn from the pointer, not from the caller's (possibly rounded) echo.
  const ringPressRef = useRef<RingPress | null>(null);
  const ringLiveRef = useRef<Record<string, number>>({});

  const ringKind = (ring: RotaryEncoderRing) => ring.kind ?? "slider";
  const ringValue = (ring: RotaryEncoderRing) => ringLiveRef.current[ring.id] ?? ring.value;
  const ringRange = (ring: RotaryEncoderRing) => [ring.min ?? 0, ring.max ?? 100] as const;
  const ringDisabled = (ring: RotaryEncoderRing) => disabled || Boolean(ring.disabled);
  const ringStep = (ring: RotaryEncoderRing) => (ringKind(ring) === "selector" ? ring.step ?? 1 : ring.step);

  /** The reading to draw, resolved against whatever the ring is showing now. */
  const ringValueText = (ring: RotaryEncoderRing) => {
    if (ring.symmetric) return undefined;
    return typeof ring.valueText === "function" ? ring.valueText(ringValue(ring)) : ring.valueText;
  };

  /**
   * What to measure the ring's length against. Never calls a `valueText`
   * function — its answer changes every frame of a drag, and a ring that
   * re-measured itself mid-turn would visibly breathe.
   */
  const ringWidestText = (ring: RotaryEncoderRing) => {
    if (ring.symmetric) return "";
    if (ring.valueTextWidest) return ring.valueTextWidest;
    return typeof ring.valueText === "string" ? ring.valueText : "";
  };

  const setRing = (ring: RotaryEncoderRing, next: number) => {
    const [min, max] = ringRange(ring);
    const bounded = clamp(next, Math.min(min, max), Math.max(min, max));
    if (bounded === ringValue(ring)) return false;
    ringLiveRef.current[ring.id] = bounded;
    rerender((count) => count + 1);
    noteInput();
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

  const [ends, setEnds] = useState<number[]>([]);
  const endOf = (index: number) => ends[index] ?? ARC_END;

  const applyRingAngle = (press: RingPress, angleAt: number) => {
    const ring = shown[press.index];
    const [min, max] = ringRange(ring);
    const half = geometry.thumbHalfAngle[press.index];
    press.drag = dragStep(press.drag, angleAt, half, endOf(press.index));
    return setRing(ring, valueAt(press.drag.t, min, max, ringStep(ring)));
  };

  const ringHandlers = {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
      const { distance, angle: at } = locate(event);
      const index = ringAt(geometry, distance);
      if (index === null || at < ARC_START || at > endOf(index)) return;
      const ring = shown[index];
      if (ringDisabled(ring)) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      noteInput();
      if (ringKind(ring) === "toggle") {
        // No thumb and no drag: the press is the whole gesture.
        const [min, max] = ringRange(ring);
        selectionHaptic();
        const next = ringValue(ring) > (min + max) / 2 ? min : max;
        ring.onChange(next);
        ring.onCommit?.(next);
        return;
      }
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
      noteInput();
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

  const ringKeyDown = (ring: RotaryEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (ringDisabled(ring)) return;
    const [min, max] = ringRange(ring);
    if (ringKind(ring) === "toggle") {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      noteInput();
      const next = ringValue(ring) > (min + max) / 2 ? min : max;
      ring.onChange(next);
      ring.onCommit?.(next);
      return;
    }
    // With a step, Shift cannot go finer than it: the value would snap back.
    const step = ringStep(ring);
    const base = step ?? Math.abs(max - min) / 100;
    const moved = event.shiftKey && !step ? base / FINE_DIVISOR : base;
    let direction = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") direction = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") direction = -1;
    if (direction === 0) return;
    event.preventDefault();
    const from = ringValue(ring);
    const next = step
      ? valueAt(fractionOf(from + direction * moved, min, max), min, max, step)
      : from + direction * moved;
    ringLiveRef.current[ring.id] = from;
    setRing(ring, next);
  };

  const ringKeyUp = (ring: RotaryEncoderRing) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    const final = ringValue(ring);
    delete ringLiveRef.current[ring.id];
    if (!ringDisabled(ring)) ring.onCommit?.(final);
  };

  // Labels are cut, and rings shortened, against measured text widths — so they
  // are measured after layout on a throwaway <text> carrying the label's class
  // and size, never on the nodes React owns.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [fitted, setFitted] = useState<string[]>([]);
  const labelKey = shown
    .map((ring) => `${ring.label}${ringWidestText(ring)}`)
    .join(" ");
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("class", "rotary-encoder-ring-label rotary-encoder-etch-face");
    probe.setAttribute("font-size", String(geometry.font));
    probe.setAttribute("visibility", "hidden");
    svg.appendChild(probe);
    const width = (text: string) => {
      probe.textContent = text;
      return typeof probe.getComputedTextLength === "function" ? probe.getComputedTextLength() : 0;
    };
    const nextEnds: number[] = [];
    const next = shown.map((ring, index) => {
      const full = ring.label.toUpperCase();
      const widest = ringWidestText(ring).toUpperCase();
      const end = ring.symmetric ? ARC_END : ringEndFor(geometry, index, width(full), width(widest));
      nextEnds.push(end);
      const room = labelRoom(geometry, index, end) - (widest ? width(widest) + geometry.font * 1.5 : 0);
      if (width(full) <= room) return full;
      for (let keep = full.length - 1; keep > 0; keep -= 1) {
        const cut = `${full.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (width(cut) <= room) return cut;
      }
      return ELLIPSIS;
    });
    probe.remove();
    const same = (a: string[] | number[], b: string[] | number[]) =>
      a.length === b.length && a.every((item, index) => item === b[index]);
    setFitted((currentFitted) => (same(currentFitted, next) ? currentFitted : next));
    setEnds((currentEnds) => (same(currentEnds, nextEnds) ? currentEnds : nextEnds));
    // geometry derives from dialSize and the ring count alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, dialSize, shown.length, showRings]);

  // The knob's own text is cut the same way, against its max-width.
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [faceTopFitted, setFaceTopFitted] = useState(faceTop ?? "");
  useLayoutEffect(() => {
    const host = dialRef.current;
    if (!faceTop || !host) {
      setFaceTopFitted(faceTop ?? "");
      return;
    }
    const probe = document.createElement("span");
    probe.className = ["rotary-encoder-label", faceTopClassName].filter(Boolean).join(" ");
    probe.style.visibility = "hidden";
    probe.style.maxWidth = "none";
    host.appendChild(probe);
    const room = dialSize * 0.7;
    const fits = (text: string) => {
      probe.textContent = text;
      // jsdom lays nothing out; there, everything fits.
      return probe.getBoundingClientRect().width <= room;
    };
    let next = faceTop;
    if (!fits(faceTop)) {
      next = ELLIPSIS;
      for (let keep = faceTop.length - 1; keep > 0; keep -= 1) {
        const cut = `${faceTop.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (fits(cut)) {
          next = cut;
          break;
        }
      }
    }
    probe.remove();
    setFaceTopFitted(next);
  }, [faceTop, faceTopClassName, dialSize]);

  // ── The floating ring layer ───────────────────────────────────────────────

  // With tuck-away on, the rings float over the page instead of taking layout
  // space, and a scrolling or clipped ancestor must not cut them off — so they
  // are portalled to the body and pinned to the dial (the dashboard's dropdown
  // rule). Their layer is clipped to an annulus, which keeps the knob visible,
  // tappable, and in front of a ring collapsing behind it.
  const floating = tuckable;
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!floating || !showRings) return;
    let frame = 0;
    const track = () => {
      const rect = dialRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        setAnchor((held) => {
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return held && Math.abs(held.x - x) < 0.5 && Math.abs(held.y - y) < 0.5 ? held : { x, y };
        });
      }
      frame = window.requestAnimationFrame(track);
    };
    frame = window.requestAnimationFrame(track);
    return () => window.cancelAnimationFrame(frame);
  }, [floating, showRings]);

  const ringsSvg = shown.length === 0 ? null : (
    <svg
      ref={svgRef}
      className="rotary-encoder-rings"
      data-collapsed={tuckable && locked ? "true" : undefined}
      style={{ clipPath: annulusClip(geometry.footprint, geometry.knobRadius) }}
      width={geometry.footprint}
      height={geometry.footprint}
      viewBox={`0 0 ${geometry.footprint} ${geometry.footprint}`}
      {...ringHandlers}
    >
      <defs>
        {/* The colour ring's sunken lighting: dark at the top left, a
            little light at the bottom right. */}
        <linearGradient id={`${ringIdBase}-shade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
          <stop offset="0" className="rotary-encoder-shade-a" />
          <stop offset="0.45" className="rotary-encoder-shade-b" />
          <stop offset="1" className="rotary-encoder-shade-c" />
        </linearGradient>
        <linearGradient id={`${ringIdBase}-lip`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geometry.footprint} y2={geometry.footprint}>
          <stop offset="0" className="rotary-encoder-lip-a" />
          <stop offset="0.55" className="rotary-encoder-lip-b" />
          <stop offset="1" className="rotary-encoder-lip-c" />
        </linearGradient>
        {shown.map((ring, index) => (
          <path key={ring.id} id={`${ringIdBase}-label-${index}`} d={labelPath(centre, centre, geometry.radii[index], endOf(index))} />
        ))}
      </defs>
      {/* Nothing may squeeze between the rings to a control underneath. */}
      {!locked ? (
        <circle
          className="rotary-encoder-blocker"
          data-testid="rotary-encoder-blocker"
          cx={centre}
          cy={centre}
          r={centre}
          onPointerDown={noteInput}
        />
      ) : null}
      {/* The rings themselves still disappear behind the knob's rim as they
          tuck: the layer's own clip now stops at the knob so presses can reach
          them, so the hiding is done here instead. */}
      <g style={{ clipPath: annulusClip(geometry.footprint, geometry.dialRadius) }}>
      {shown.map((ring, index) => {
        const radius = geometry.radii[index];
        const half = geometry.thumbHalfAngle[index];
        const [min, max] = ringRange(ring);
        const end = endOf(index);
        const item = ringValue(ring);
        const kind = ringKind(ring);
        const fraction = fractionOf(item, min, max);
        const thumbAt = thumbAngle(fraction, half, end);
        const labelText = fitted[index] ?? ring.label.toUpperCase();
        const trackPath = arcPath(centre, centre, radius, ARC_START, end);
        // The path between the thumb's round ends: its visible length is
        // THUMB_LENGTH tracks, of which the two caps take THUMB_THICKNESS.
        const thumbCore = ((THUMB_LENGTH - THUMB_THICKNESS) * track) / 2 / radius * (180 / Math.PI);
        const thumbPath = arcPath(centre, centre, radius, thumbAt - thumbCore, thumbAt + thumbCore);
        const off = ringDisabled(ring);
        const on = kind === "toggle" && item > (min + max) / 2;
        const wholeTrackFill = kind === "toggle" ? (on ? ring.fill ?? null : null) : kind === "selector" ? ring.fill ?? null : null;
        // Innermost hides first and appears first; the outermost is last either
        // way (specs/color-encoder.md, "Tuck-away").
        // Shrinking only as far as the knob's rim is a few percent on the
        // innermost ring, which does not read as movement at all — so a ring
        // travels well inside the rim, where the annulus clip hides it behind
        // the knob.
        const tucked = (geometry.dialRadius * 0.78) / radius;
        const tuckedStyle = locked || entering;
        // Hiding goes innermost-first, outermost-last; unlocking is that
        // collapse in reverse, so the ring that was last to leave is first
        // to come back.
        const stagger = locked ? index : shown.length - 1 - index;
        const collapse: CSSProperties = tuckable
          ? {
            transform: tuckedStyle ? `scale(${tucked.toFixed(3)})` : "scale(1)",
            opacity: tuckedStyle ? 0 : 1,
            transitionDelay: `${stagger * TUCK_RING_STAGGER_MS}ms`,
          }
          : {};
        return (
          <g
            key={ring.id}
            className="rotary-encoder-ring-slider"
            data-ring-index={index}
            data-ring-id={ring.id}
            data-ring-kind={kind}
            data-disabled={off ? "true" : undefined}
            style={collapse}
            role={kind === "toggle" ? "switch" : "slider"}
            tabIndex={off ? -1 : 0}
            aria-label={ring.label}
            aria-disabled={off}
            {...(kind === "toggle"
              ? { "aria-checked": on }
              : {
                "aria-valuemin": Math.min(min, max),
                "aria-valuemax": Math.max(min, max),
                "aria-valuenow": Math.round(item * 100) / 100,
                "aria-valuetext": ringValueText(ring),
              })}
            onKeyDown={ringKeyDown(ring)}
            onKeyUp={ringKeyUp(ring)}
          >
            <path className="rotary-encoder-focus" d={trackPath} strokeWidth={track + 6} />
            <path className="rotary-encoder-lip" d={trackPath} strokeWidth={track + 2 * Math.max(1, track * 0.18)} stroke={`url(#${ringIdBase}-lip)`} />
            <path className="rotary-encoder-well" d={trackPath} strokeWidth={track} />
            <path className="rotary-encoder-well-shade" d={trackPath} strokeWidth={track} stroke={`url(#${ringIdBase}-shade)`} />
            {/* A selector and a toggle fill the whole track in the caller's
                colour rather than filling behind the thumb. */}
            {kind === "slider" ? (
              fraction > 0 ? (
                <path className="rotary-encoder-fill" d={arcPath(centre, centre, radius, ARC_START, thumbAt)} strokeWidth={track * 0.6} />
              ) : null
            ) : (
              <path
                className="rotary-encoder-whole-fill"
                d={trackPath}
                strokeWidth={track * 0.6}
                stroke={wholeTrackFill ?? "transparent"}
                style={wholeTrackFill ? ({ "--re-fill": wholeTrackFill } as CSSProperties) : undefined}
                data-on={wholeTrackFill ? "true" : "false"}
              />
            )}
            {kind === "toggle" ? null : (
              <g className="rotary-encoder-thumb">
                <path className="rotary-encoder-thumb-edge" d={thumbPath} strokeWidth={track * THUMB_THICKNESS + 1} />
                <path className="rotary-encoder-thumb-body" d={thumbPath} strokeWidth={track * THUMB_THICKNESS} />
                <path className="rotary-encoder-thumb-crown" d={thumbPath} strokeWidth={track * THUMB_THICKNESS * 0.55} />
              </g>
            )}
            {/* Flat, unembossed (Adeline, 2026-09-12): the offset copies that
                used to etch this read as black shadows above and below it. */}
            <text
              className="rotary-encoder-ring-label rotary-encoder-etch-face"
              fontSize={geometry.font}
              aria-hidden
            >
              {/* Left-aligned to where the ring's track starts, at 7:30, so
                  every ring's label begins on the same radius. */}
              <textPath href={`#${ringIdBase}-label-${index}`} startOffset={track}>
                {labelText}
              </textPath>
            </text>
            {(() => {
              const valueText = ringValueText(ring);
              return valueText ? (
                <text
                  className="rotary-encoder-ring-label rotary-encoder-ring-value rotary-encoder-etch-face"
                  fontSize={geometry.font}
                  aria-hidden
                >
                  {/* Right-aligned so it ends where the ring's track ends. */}
                  <textPath href={`#${ringIdBase}-label-${index}`} startOffset={Math.max(0, gapLength(geometry, index, end) - track)}>
                    {valueText.toUpperCase()}
                  </textPath>
                </text>
              ) : null;
            })()}
          </g>
        );
      })}
      </g>
    </svg>
  );

  const ringLayer = !floating
    ? ringsSvg
    : mounted && showRings && ringsSvg && typeof document !== "undefined"
      ? createPortal(
        <div
          ref={ringLayerRef}
          className={["rotary-encoder", "rotary-encoder-ring-layer", disabled ? "rotary-encoder-disabled" : ""].filter(Boolean).join(" ")}
          data-mode={mode}
          data-locked={locked ? "true" : "false"}
          style={{
            left: `${anchor?.x ?? 0}px`,
            top: `${anchor?.y ?? 0}px`,
            width: `${geometry.footprint}px`,
            height: `${geometry.footprint}px`,
            clipPath: annulusClip(geometry.footprint, geometry.knobRadius),
            visibility: anchor ? "visible" : "hidden",
            "--re-size": `${dialSize}px`,
            "--re-track": `${track.toFixed(2)}px`,
            ...(color ? { "--re-color": color } : {}),
          } as CSSProperties}
        >
          {ringsSvg}
        </div>,
        document.body,
      )
      : null;

  return (
    <div
      ref={rootRef}
      data-mode={mode}
      data-led-labels={ledLabels ? "true" : undefined}
      data-locked={tuckable ? (locked ? "true" : "false") : undefined}
      className={["rotary-encoder", variantClassName, disabled ? "rotary-encoder-disabled" : "", floating ? "rotary-encoder-floating" : "", className].filter(Boolean).join(" ")}
      style={{
        "--re-size": `${dialSize}px`,
        ...(color ? { "--re-color": color } : {}),
        ...(ringPaint ? { "--re-ring-paint": ringPaint } : {}),
        "--re-glow": glow ?? "0 0 0 rgba(0, 0, 0, 0)",
        "--re-angle": `${angle.toFixed(2)}deg`,
        "--re-pitch": `${geometry.pitch.toFixed(2)}px`,
        "--re-track": `${track.toFixed(2)}px`,
        "--re-rings": String(shown.length),
        "--re-footprint": `${geometry.footprint.toFixed(2)}px`,
        "--re-font": `${geometry.font.toFixed(2)}px`,
      } as CSSProperties}
    >
      {ringLayer}
      <div
        ref={dialRef}
        className="rotary-encoder-dial"
        role="slider"
        aria-label={ariaLabel ?? (faceTop ? undefined : "Dial")}
        aria-labelledby={ariaLabel || !faceTop ? undefined : labelId}
        aria-disabled={disabled}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={Math.round(detented * 100) / 100}
        aria-valuetext={ariaValueText}
        data-led={led}
        data-pressed={pressed ? "true" : undefined}
        data-demo-tooltip-title={demoTooltipTitle}
        data-demo-tooltip={demoTooltip}
        tabIndex={disabled ? -1 : 0}
        {...pointerHandlers}
      >
        <span className="rotary-encoder-outer-bevel" aria-hidden />
        <span className="rotary-encoder-glow" aria-hidden />
        {checker ? <span className="rotary-encoder-checker" aria-hidden /> : null}
        <span className="rotary-encoder-ring" aria-hidden />
        <span className="rotary-encoder-ring-shade" aria-hidden />
        <span className="rotary-encoder-inner-bevel" aria-hidden />
        <span className="rotary-encoder-knob" aria-hidden />
        <span className="rotary-encoder-rotor" aria-hidden>
          <span className="rotary-encoder-index" />
        </span>
        <span className="rotary-encoder-spec" aria-hidden />
        {faceTop ? (
          <span
            className={["rotary-encoder-label", faceTopClassName].filter(Boolean).join(" ")}
            id={labelId}
            aria-label={faceTop}
          >
            {faceTopFitted}
          </span>
        ) : null}
        <span className="rotary-encoder-leds" data-labelled={ledLabels ? "true" : undefined} aria-hidden>
          {leds.map((item) => (
            <span key={item.id} className="rotary-encoder-led-slot">
              <span
                className="rotary-encoder-led"
                data-lit={item.id === led ? "true" : "false"}
                data-channel={item.id}
              />
              {ledLabels ? <span className="rotary-encoder-led-name">{item.label}</span> : null}
            </span>
          ))}
        </span>
        {faceBottom ? (
          <span className={["rotary-encoder-channel", faceBottomClassName].filter(Boolean).join(" ")}>
            {faceBottom}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
