"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useLiteMode } from "./dashboard/experienceModeSetting";
import { decimalStepGranularity } from "../../lib/slider-step";
import {
  beginControlInteraction,
  CONTROL_INTERACTION_COOLDOWN_MS,
  endControlInteraction,
  markControlInteraction,
} from "./controlInteractionCooldown";
import { selectionHaptic, SliderHapticController } from "./haptics";
import { useNumericEntry } from "./NumericEntryPopover";
import {
  beginTap,
  cancelTapTimer,
  endedAsTap,
  observeTap,
  promoteTap,
  type SliderTapGesture,
} from "./sliderTapGesture";

type Rgb = [number, number, number];
type DotColor = Rgb | string;
type Cursor = { x: number; y: number };
type SpectrumDot = { decorative?: boolean; id: string; rgb: Rgb; x: number; xPx: number; y: number; yPx: number };

const DOT_GAP_PX = 15;
const SPECTRUM_CURSOR_INSET_PX = 40;
const DOT_INFLUENCE_RADIUS_PX = 140;
const SVG_DOT_RADIUS_PX = 1.0;
const SVG_SPECTRUM_CURSOR_RADIUS_PX = 38;
const SVG_SPECTRUM_CURSOR_STROKE_PX = 3;
const REMOTE_EASE_MS = 1000;
const DECORATIVE_SPECTRUM_DOT_RGB: Rgb = [24, 26, 27];
const DISABLED_DOT_RGB: Rgb = [126, 126, 126];
const IOS_BOTTOM_GESTURE_BLIND_SPOT_PX = 96;
const RECT_THUMB_WIDTH_PX = 36;
const PRECISION_DRAG_DEAD_ZONE_PX = 30;
const PRECISION_DRAG_FULL_EFFECT_PX = 100;
const PRECISION_DRAG_MIN_SCALE = 0.25;

type PrecisionDrag = { currentValue: number; lastX: number };

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function precisionDragScale(verticalDistance: number) {
  const progress = clamp(
    (Math.abs(verticalDistance) - PRECISION_DRAG_DEAD_ZONE_PX)
      / (PRECISION_DRAG_FULL_EFFECT_PX - PRECISION_DRAG_DEAD_ZONE_PX),
    0,
    1,
  );
  return 1 - progress * (1 - PRECISION_DRAG_MIN_SCALE);
}

function verticalDistanceOutside(clientY: number, rect: Pick<DOMRect, "bottom" | "top">) {
  return Math.max(rect.top - clientY, clientY - rect.bottom, 0);
}

function accumulatePrecisionDrag(drag: PrecisionDrag, clientX: number, verticalDistance: number, valuePerPixel: number) {
  const scale = precisionDragScale(verticalDistance);
  drag.currentValue += (clientX - drag.lastX) * valuePerPixel * scale;
  drag.lastX = clientX;
  return drag.currentValue;
}

function easeOut(value: number) {
  const smoothProgress = value * value * (3 - 2 * value);
  return 1 - Math.pow(1 - smoothProgress, 2.25);
}

function insetPixel(value: number, length: number, insetPx: number) {
  if (length <= 0) {
    return clamp(value, 0, 1) * length;
  }

  const inset = Math.min(insetPx, length / 2);
  return inset + clamp(value, 0, 1) * Math.max(0, length - inset * 2);
}

function pixelToInsetRatio(pixel: number, length: number, insetPx: number) {
  if (length <= 0) {
    return 0;
  }

  const inset = Math.min(insetPx, length / 2);
  const usable = Math.max(0, length - inset * 2);

  if (usable <= 0) {
    return 0.5;
  }

  return clamp((pixel - inset) / usable, 0, 1);
}

function insetPercent(value: number, length: number, insetPx: number) {
  return length > 0 ? (insetPixel(value, length, insetPx) / length) * 100 : clamp(value, 0, 1) * 100;
}

function focusedDotScale(distance: number, radius: number) {
  const weight = clamp(1 - distance / radius, 0, 1);
  // Quartic falloff: concentrates magnification near the cursor, drops off fast toward the edge
  const eased = weight * weight * weight * weight;
  const base = 1 + eased * 5.5;

  // Sharp centre spike: 4× normal max at distance 0, cubic falloff over ~12px
  const spikeWeight = clamp(1 - distance / 12, 0, 1);
  const spike = spikeWeight * spikeWeight * spikeWeight * 8.5;

  return Math.round((base + spike) * 100) / 100;
}

function svgDotRadius(scale: number) {
  return Math.round(SVG_DOT_RADIUS_PX * scale * 100) / 100;
}

function scaledRgb(rgb: Rgb, scale: number): Rgb {
  return rgb.map((part) => clamp(Math.round(part * scale), 0, 255)) as Rgb;
}

function isBottomGestureBlindSpot(event: React.PointerEvent<HTMLElement>) {
  if (typeof window === "undefined" || event.pointerType === "mouse") {
    return false;
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  return event.clientY >= Math.max(0, viewportHeight - IOS_BOTTOM_GESTURE_BLIND_SPOT_PX);
}

// Animates a 1D number toward target, snapping during local drag and easing on remote changes.
// In lite mode the easing rAF loop is skipped and remote changes snap directly.
// `snapRemote` opts a control out of the easing entirely: its value is always the
// exact target, never a frame part-way there. Used where the number shown must be
// the value that was set — see DotLineControl's `snapRemote` prop.
function useRemoteEasedNumber(target: number, snapRemote = false) {
  const lite = useLiteMode() || snapRemote;
  const [displayValue, setDisplayValue] = useState(target);
  const [releaseRevision, setReleaseRevision] = useState(0);
  const displayValueRef = useRef(target);
  const latestTargetRef = useRef(target);
  const localInteractionRef = useRef(false);
  const remoteHoldUntilRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  latestTargetRef.current = target;

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const setImmediate = useCallback(
    (next: number) => {
      cancelAnimation();
      displayValueRef.current = next;
      setDisplayValue(next);
    },
    [cancelAnimation],
  );

  const setLocalValue = useCallback(
    (next: number) => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      localInteractionRef.current = true;
      remoteHoldUntilRef.current = Number.POSITIVE_INFINITY;
      setImmediate(next);
    },
    [setImmediate],
  );

  const releaseLocalValue = useCallback(
    (next: number) => {
      setImmediate(next);
      localInteractionRef.current = false;
      remoteHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = window.setTimeout(() => {
        releaseTimerRef.current = null;
        setReleaseRevision((current) => current + 1);
      }, CONTROL_INTERACTION_COOLDOWN_MS);
    },
    [setImmediate],
  );

  useEffect(() => {
    // Incoming state is never allowed to move a slider during a gesture or the
    // six-second release cooldown. The latest target is reconciled afterwards.
    if (localInteractionRef.current || Date.now() < remoteHoldUntilRef.current) {
      return;
    }

    cancelAnimation();
    const start = displayValueRef.current;
    const nextTarget = latestTargetRef.current;
    if (lite || Math.abs(nextTarget - start) < 0.01) {
      displayValueRef.current = nextTarget;
      setDisplayValue(nextTarget);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / REMOTE_EASE_MS, 0, 1);
      const next = start + (nextTarget - start) * easeOut(progress);
      displayValueRef.current = next;
      setDisplayValue(next);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        displayValueRef.current = nextTarget;
        setDisplayValue(nextTarget);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [cancelAnimation, lite, releaseRevision, target]);

  useEffect(() => () => {
    cancelAnimation();
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
  }, [cancelAnimation]);

  return { displayValue, releaseLocalValue, releaseRevision, setLocalValue };
}

// Animates a 2D cursor toward target, snapping during local drag and easing on remote changes.
// In lite mode the easing rAF loop is skipped and remote changes snap directly.
function useEasedCursor(targetX: number, targetY: number) {
  const lite = useLiteMode();
  const [display, setDisplay] = useState<Cursor>({ x: targetX, y: targetY });
  const displayRef = useRef<Cursor>({ x: targetX, y: targetY });
  const localRef = useRef(false);
  const animRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const setLocal = useCallback(
    (next: Cursor) => {
      cancel();
      localRef.current = true;
      displayRef.current = next;
      setDisplay(next);
    },
    [cancel],
  );

  const release = useCallback(
    (next: Cursor) => {
      cancel();
      displayRef.current = next;
      setDisplay(next);
      localRef.current = false;
    },
    [cancel],
  );

  useEffect(() => {
    if (localRef.current) {
      const next = { x: targetX, y: targetY };
      displayRef.current = next;
      setDisplay(next);
      return;
    }

    cancel();
    const start = displayRef.current;
    const dist = Math.hypot(targetX - start.x, targetY - start.y);
    if (lite || dist < 0.001) {
      const next = { x: targetX, y: targetY };
      displayRef.current = next;
      setDisplay(next);
      return;
    }

    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = clamp((now - startedAt) / REMOTE_EASE_MS, 0, 1);
      const e = easeOut(t);
      const next = { x: start.x + (targetX - start.x) * e, y: start.y + (targetY - start.y) * e };
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        displayRef.current = { x: targetX, y: targetY };
        setDisplay({ x: targetX, y: targetY });
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [cancel, lite, targetX, targetY]);

  useEffect(() => cancel, [cancel]);

  return { display, setLocal, release };
}

export function DotLineControl({
  ariaLabel,
  ariaValueText,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  fill = false,
  markers,
  max = 100,
  min = 0,
  numericEntry = true,
  numericEntryLabel,
  onChange,
  onCommit,
  snapRemote = false,
  snapTolerance,
  snapValue,
  step: requestedStep = 1,
  value,
}: {
  /** Retained for API compatibility; the rectangular slider thumb uses the theme
   *  accent/highlight colours, not a per-control colour. */
  activeColor?: DotColor;
  ariaLabel: string;
  ariaValueText?: string;
  color?: DotColor;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  /** Tinted accent back-fill up to the thumb. On for magnitudes (brightness),
   *  off for stepped choices (fan speed). */
  fill?: boolean;
  dotOpacity?: number;
  intensity?: number;
  markers?: Array<{ active?: boolean; label: string; value: number }>;
  max?: number;
  min?: number;
  /** Tapping without dragging opens a numeric field. Off for a control whose
   *  positions are named choices rather than a number worth typing. */
  numericEntry?: boolean;
  /** Heading on that field. Defaults to `ariaLabel`. */
  numericEntryLabel?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  /** Take incoming values instantly instead of easing the thumb toward them, so the
   *  slider only ever shows a real value — never a frame of an animation between
   *  two of them. Set for controls whose number must be exactly what was set (zone
   *  intensity); left off elsewhere, where the glide is wanted. */
  snapRemote?: boolean;
  /** Magnetic zone around `snapValue` (in value units). When a pointer drag lands
   *  within it, the value snaps exactly to `snapValue`. Defaults to a couple of
   *  steps / ~3% of the range so a fixed default marker is easy to settle on. */
  snapTolerance?: number;
  /** A fixed value the slider magnetically snaps to on drag (e.g. the default). */
  snapValue?: number;
  step?: number;
  value: number;
}) {
  const step = decimalStepGranularity(requestedStep);
  const padRef = useRef<HTMLDivElement | null>(null);
  const commitValueRef = useRef(value);
  const draggingRef = useRef(false);
  const precisionDragRef = useRef<PrecisionDrag | null>(null);
  const hapticsRef = useRef(new SliderHapticController());
  const incomingValueHoldUntilRef = useRef(0);
  const tapRef = useRef<SliderTapGesture | null>(null);
  const entry = useNumericEntry();
  const [interacting, setInteracting] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  const { displayValue, releaseLocalValue, releaseRevision, setLocalValue } = useRemoteEasedNumber(
    value,
    snapRemote,
  );
  const range = Math.max(step, max - min);
  const displayRatio = clamp((displayValue - min) / range, 0, 1);
  // Thumb centre is inset by half its width so it never overflows the track ends;
  // the accent back-fill (when enabled) stops at that centre.
  const thumbCenterPx = insetPixel(displayRatio, lineWidth, RECT_THUMB_WIDTH_PX / 2);

  useEffect(() => () => {
    if (draggingRef.current) {
      draggingRef.current = false;
      endControlInteraction();
    }
  }, []);

  useEffect(() => {
    if (!draggingRef.current && Date.now() >= incomingValueHoldUntilRef.current) {
      commitValueRef.current = value;
    }
  }, [releaseRevision, value]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      setLineWidth(pad.getBoundingClientRect().width);
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(pad);
    window.addEventListener("orientationchange", rebuild);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", rebuild);
    };
  }, []);

  const roundToStep = useCallback(
    (next: number) => clamp(Math.round(next / step) * step, min, max),
    [max, min, step],
  );

  const setControlValue = useCallback(
    (next: number) => {
      const stepped = roundToStep(next);
      commitValueRef.current = stepped;
      setLocalValue(stepped);
      onChange(stepped);
      return stepped;
    },
    [onChange, roundToStep, setLocalValue],
  );

  // Magnetic snap zone around a fixed value (e.g. the default marker). Defaults
  // to whichever is larger of two steps or 3% of the range, so a single-value
  // target is comfortable to settle on without making the rest of the track feel
  // sticky.
  const effectiveSnapTolerance =
    snapTolerance ?? Math.max(step * 2, range * 0.03);

  const snap = useCallback((raw: number) => (
    snapValue !== undefined && Math.abs(raw - snapValue) <= effectiveSnapTolerance
      ? snapValue
      : raw
  ), [effectiveSnapTolerance, snapValue]);

  const pick = useCallback(
    (clientX: number) => {
      if (disabled || !padRef.current) {
        return;
      }

      const rect = padRef.current.getBoundingClientRect();
      const raw = min + ((clientX - rect.left) / rect.width) * range;
      return setControlValue(snap(raw));
    },
    [disabled, min, range, setControlValue, snap],
  );

  // The press used to move the value immediately. It is deferred now, so a tap
  // can mean "let me type this instead" — see sliderTapGesture. This is what
  // runs once the gesture is known to be a drag, and it runs at the coordinates
  // of the original press so the drag maths below are unchanged.
  const beginDrag = useCallback(
    (clientX: number) => {
      const startValue = pick(clientX);
      if (startValue === undefined) return;
      hapticsRef.current.start({ value: startValue, step });
      if (padRef.current) {
        precisionDragRef.current = { currentValue: startValue, lastX: clientX };
      }
    },
    [pick, step],
  );

  const drag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = padRef.current?.getBoundingClientRect();
      const precisionDrag = precisionDragRef.current;
      if (!rect || !precisionDrag) return;
      const previousX = precisionDrag.lastX;
      const verticalDistance = verticalDistanceOutside(event.clientY, rect);
      const raw = accumulatePrecisionDrag(
        precisionDrag,
        event.clientX,
        verticalDistance,
        range / Math.max(1, rect.width),
      );
      precisionDrag.currentValue = clamp(raw, min, max);
      const nextValue = setControlValue(snap(raw));
      hapticsRef.current.move(
        Math.abs(event.clientX - previousX) * precisionDragScale(verticalDistance) / Math.max(1, rect.width),
        { value: nextValue },
      );
    },
    [max, min, range, setControlValue, snap],
  );

  const commit = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    precisionDragRef.current = null;
    hapticsRef.current.stop();
    endControlInteraction();
    incomingValueHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
    setInteracting(false);
    releaseLocalValue(commitValueRef.current);
    onCommit?.(commitValueRef.current);
  }, [onCommit, releaseLocalValue]);

  const openNumericEntry = useCallback(() => {
    const pad = padRef.current;
    if (!pad) return;

    // The value is pinned for as long as the field is open: a poll landing
    // mid-edit must not ease the thumb away under the number being typed.
    setLocalValue(commitValueRef.current);
    incomingValueHoldUntilRef.current = Number.POSITIVE_INFINITY;
    entry.open({
      anchor: pad,
      anchorOffsetX: thumbCenterPx,
      label: numericEntryLabel ?? ariaLabel,
      max,
      min,
      onClose: () => {
        incomingValueHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
        releaseLocalValue(commitValueRef.current);
      },
      onCommit: (next) => {
        markControlInteraction();
        const stepped = roundToStep(next);
        commitValueRef.current = stepped;
        setLocalValue(stepped);
        onChange(stepped);
        onCommit?.(stepped);
      },
      step,
      value: commitValueRef.current,
    });
  }, [
    ariaLabel, entry, max, min, numericEntryLabel, onChange, onCommit, releaseLocalValue,
    roundToStep, setLocalValue, step, thumbCenterPx,
  ]);

  const finish = useCallback(() => {
    const gesture = tapRef.current;
    tapRef.current = null;
    if (gesture && draggingRef.current && endedAsTap(gesture)) {
      // A tap changed nothing and must not commit; it asks for the field.
      draggingRef.current = false;
      precisionDragRef.current = null;
      hapticsRef.current.stop();
      endControlInteraction();
      setInteracting(false);
      openNumericEntry();
      return;
    }
    commit();
  }, [commit, openNumericEntry]);

  const keyStep = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, next: number) => {
      event.preventDefault();
      markControlInteraction();
      const stepped = roundToStep(next);
      setControlValue(stepped);
      selectionHaptic();
      incomingValueHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
      releaseLocalValue(stepped);
      onCommit?.(stepped);
    },
    [onCommit, releaseLocalValue, roundToStep, setControlValue],
  );

  const slider = (
    <div
      ref={padRef}
      role="slider"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(displayValue)}
      aria-valuetext={ariaValueText}
      data-demo-tooltip-title={demoTooltipTitle}
      data-demo-tooltip={demoTooltip}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          keyStep(event, commitValueRef.current - step);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          keyStep(event, commitValueRef.current + step);
        } else if (event.key === "PageDown") {
          keyStep(event, commitValueRef.current - step * 10);
        } else if (event.key === "PageUp") {
          keyStep(event, commitValueRef.current + step * 10);
        } else if (event.key === "Home") {
          keyStep(event, min);
        } else if (event.key === "End") {
          keyStep(event, max);
        }
      }}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginControlInteraction();
        draggingRef.current = true;
        incomingValueHoldUntilRef.current = Number.POSITIVE_INFINITY;
        setInteracting(true);
        const startX = event.clientX;
        tapRef.current = beginTap(event, () => beginDrag(startX));
        if (!numericEntry) {
          promoteTap(tapRef.current, () => beginDrag(startX));
        }
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) {
          return;
        }
        const startX = tapRef.current?.clientX ?? event.clientX;
        if (!observeTap(tapRef.current, event, () => beginDrag(startX))) {
          return;
        }
        drag(event);
      }}
      // Both, because Chromium releases the capture around pointerup and the
      // two arrive in an order that is not worth depending on. The gesture is
      // consumed once; whichever event is second falls through to a commit that
      // has nothing left to do.
      onPointerUp={finish}
      onLostPointerCapture={finish}
      onPointerCancel={() => {
        cancelTapTimer(tapRef.current);
        tapRef.current = null;
        commit();
      }}
      className={classNames(
        "rect-slider relative flex h-12 w-full items-center touch-none select-none outline-none",
        interacting && "rect-slider-active",
        disabled && "rect-slider-disabled",
      )}
    >
      <div className="rect-slider-track">
        {fill ? <div className="rect-slider-fill" style={{ width: `${thumbCenterPx}px` }} aria-hidden="true" /> : null}
      </div>
      <div className="rect-slider-thumb" style={{ left: `${thumbCenterPx}px` }} aria-hidden="true" />
    </div>
  );

  if (!markers?.length) {
    return (
      <>
        {slider}
        {entry.element}
      </>
    );
  }

  return (
    <>
      {slider}
      {entry.element}
      <div className="dot-line-markers relative mt-2 h-4 text-xs font-black uppercase text-neutral-400">
        {markers.map((marker) => {
          const markerRatio = clamp((marker.value - min) / range, 0, 1);

          return (
            <span
              key={`${marker.value}-${marker.label}`}
              className={classNames("dot-line-marker", marker.active && "dot-line-marker-active")}
              style={{ left: `${insetPercent(markerRatio, lineWidth, RECT_THUMB_WIDTH_PX / 2)}%` }}
            >
              {marker.label}
            </span>
          );
        })}
      </div>
    </>
  );
}

export function DotRangeControl({
  ariaLabel,
  ariaValueText,
  disabled = false,
  max,
  min,
  numericEntry = true,
  onChange,
  onCommit,
  step: requestedStep,
  value,
}: {
  ariaLabel: string;
  ariaValueText?: (value: [number, number]) => [string, string];
  disabled?: boolean;
  max: number;
  min: number;
  /** Tapping a thumb without dragging opens a numeric field for it. */
  numericEntry?: boolean;
  onChange: (value: [number, number]) => void;
  onCommit?: (value: [number, number]) => void;
  step: number;
  value: [number, number];
}) {
  const step = decimalStepGranularity(requestedStep);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<0 | 1 | null>(null);
  const precisionDragRef = useRef<PrecisionDrag | null>(null);
  const hapticsRef = useRef(new SliderHapticController());
  const currentRef = useRef<[number, number]>(value);
  const tapRef = useRef<SliderTapGesture | null>(null);
  // Both the track and each thumb start a press, and they defer different work,
  // so the move handler reaches the right one through this rather than through
  // a closure it cannot see.
  const promoteRef = useRef<() => void>(() => undefined);
  const entry = useNumericEntry();
  const [interacting, setInteracting] = useState(false);
  currentRef.current = value;
  const span = Math.max(step, max - min);
  const ratio = (part: number) => clamp((part - min) / span, 0, 1);
  const labels = ariaValueText?.(value);
  // Rendered as a sibling, never a child: a portal's events still bubble
  // through the React tree, so a field inside the track would feed every
  // keystroke back into the slider's own pointer handlers.

  const stepped = useCallback((raw: number) => {
    const next = min + Math.round((raw - min) / step) * step;
    return Number(clamp(next, min, max).toFixed(12));
  }, [max, min, step]);

  // Thumbs push rather than block: dragging one into the other carries it
  // along instead of stopping dead against it. Neither can be pushed off the
  // end of the track, so the pair simply collapses to a zero-width range there
  // and the dragged thumb keeps going to the limit.
  const update = useCallback((thumb: 0 | 1, raw: number, commit = false) => {
    const next = [...currentRef.current] as [number, number];
    next[thumb] = stepped(raw);
    if (thumb === 0) next[1] = Math.max(next[0], next[1]);
    else next[0] = Math.min(next[0], next[1]);
    currentRef.current = next;
    onChange(next);
    if (commit) onCommit?.(next);
    return next;
  }, [onChange, onCommit, stepped]);

  const rawFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? min + clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * span : min;
  };

  const openNumericEntry = (thumb: 0 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    entry.open({
      anchor: track,
      anchorOffsetX: ratio(currentRef.current[thumb]) * track.getBoundingClientRect().width,
      label: `${ariaLabel} ${thumb === 0 ? "minimum" : "maximum"}`,
      max,
      min,
      onCommit: (next) => {
        markControlInteraction();
        update(thumb, next, true);
      },
      step,
      value: currentRef.current[thumb],
    });
  };

  const rawFromDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    const drag = precisionDragRef.current;
    return rect && drag
      ? accumulatePrecisionDrag(drag, event.clientX, verticalDistanceOutside(event.clientY, rect), span / Math.max(1, rect.width))
      : min;
  };

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const raw = rawFromPointer(event.clientX);
    const toMinimum = Math.abs(raw - currentRef.current[0]);
    const toMaximum = Math.abs(raw - currentRef.current[1]);
    // Which side the pointer is on breaks the tie, so a pair collapsed against
    // one end can still be pulled apart from either thumb.
    const thumb: 0 | 1 = toMinimum === toMaximum
      ? (raw >= currentRef.current[1] ? 1 : 0)
      : (toMinimum < toMaximum ? 0 : 1);
    activeThumbRef.current = thumb;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginControlInteraction();
    setInteracting(true);
    const startX = event.clientX;
    promoteRef.current = () => {
      const next = update(thumb, raw);
      hapticsRef.current.start({ value: next[thumb], step });
      precisionDragRef.current = { currentValue: next[thumb], lastX: startX };
    };
    tapRef.current = beginTap(event, () => promoteRef.current());
    if (!numericEntry) promoteTap(tapRef.current, () => promoteRef.current());
  };

  const end = () => {
    const thumb = activeThumbRef.current;
    if (thumb === null) return;
    const gesture = tapRef.current;
    tapRef.current = null;
    activeThumbRef.current = null;
    precisionDragRef.current = null;
    hapticsRef.current.stop();
    endControlInteraction();
    setInteracting(false);
    if (endedAsTap(gesture)) {
      openNumericEntry(thumb);
      return;
    }
    onCommit?.(currentRef.current);
  };

  const cancel = () => {
    cancelTapTimer(tapRef.current);
    tapRef.current = null;
    end();
  };

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>, thumb: 0 | 1) => {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value[thumb] - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value[thumb] + step;
    else if (event.key === "PageDown") next = value[thumb] - step * 10;
    else if (event.key === "PageUp") next = value[thumb] + step * 10;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    markControlInteraction();
    update(thumb, next, true);
    selectionHaptic();
  };

  return (
    <>
    <div
      ref={trackRef}
      className={classNames(
        "rect-slider rect-range-slider relative flex h-12 w-full items-center touch-none select-none",
        interacting && "rect-slider-active",
        disabled && "rect-slider-disabled",
      )}
      onPointerDown={begin}
      onPointerMove={(event) => {
        if (activeThumbRef.current !== null && event.buttons === 1) {
          // Nothing has been applied while the press might still be a tap, so
          // dragging from the unseeded accumulator would jump to nonsense.
          if (!observeTap(tapRef.current, event, () => promoteRef.current())) return;
          const thumb = activeThumbRef.current;
          const rect = trackRef.current?.getBoundingClientRect();
          const dragBefore = precisionDragRef.current;
          const previousX = dragBefore?.lastX;
          const raw = rawFromDrag(event);
          const drag = precisionDragRef.current;
          // Both thumbs can travel the whole track now that they push each
          // other, so the accumulator is only bounded by the track itself.
          if (drag) drag.currentValue = clamp(raw, min, max);
          const next = update(thumb, raw);
          if (rect && dragBefore) {
            hapticsRef.current.move(
              Math.abs(event.clientX - (previousX ?? event.clientX)) * precisionDragScale(verticalDistanceOutside(event.clientY, rect)) / Math.max(1, rect.width),
              { value: next[thumb] },
            );
          }
        }
      }}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={end}
    >
      <div className="rect-slider-track">
        <div
          className="rect-slider-fill rect-slider-range-fill"
          style={{
            left: `${ratio(value[0]) * 100}%`,
            width: `${Math.max(0, ratio(value[1]) - ratio(value[0])) * 100}%`,
          }}
          aria-hidden="true"
        />
      </div>
      {([0, 1] as const).map((thumb) => (
        <div
          key={thumb}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${ariaLabel} ${thumb === 0 ? "minimum" : "maximum"}`}
          aria-disabled={disabled}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value[thumb]}
          aria-valuetext={labels?.[thumb]}
          className="rect-slider-thumb rect-range-thumb"
          style={{ left: `${ratio(value[thumb]) * 100}%` }}
          onKeyDown={(event) => keyboard(event, thumb)}
          onPointerDown={(event) => {
            activeThumbRef.current = thumb;
            event.stopPropagation();
            event.currentTarget.parentElement?.setPointerCapture?.(event.pointerId);
            beginControlInteraction();
            setInteracting(true);
            const startX = event.clientX;
            promoteRef.current = () => {
              hapticsRef.current.start({ value: currentRef.current[thumb], step });
              precisionDragRef.current = { currentValue: currentRef.current[thumb], lastX: startX };
            };
            tapRef.current = beginTap(event, () => promoteRef.current());
            if (!numericEntry) promoteTap(tapRef.current, () => promoteRef.current());
          }}
        />
      ))}
    </div>
    {entry.element}
    </>
  );
}

export type EnvelopeDurations = [attack: number, hold: number, release: number];

function formatEnvelopeSeconds(value: number) {
  return `${value.toFixed(2).replace(/0$/, "")}s`;
}

/**
 * A three-boundary envelope timeline. Thumb widths are deliberately removed
 * from the time scale, so touching thumbs represent equal boundary times (and
 * therefore a zero-length hold or release) without ever overlapping.
 *
 * The thumbs push rather than block, and the push cascades rightwards, because
 * the three boundaries are cumulative: attack carries hold and release with it
 * so that moving the attack time does not silently rewrite the phases after it,
 * and hold carries release for the same reason. Nothing pushes leftwards —
 * hold stops against attack and release stops against hold — and nothing is
 * ever pushed off the end of the track, so a carried thumb pinned at the end
 * gives up its gap and shrinks instead. The gaps a drag tries to preserve are
 * the ones it started with, so dragging out to the end and back restores them.
 */
export function DotEnvelopeControl({
  ariaLabel,
  disabled = false,
  max,
  numericEntry = true,
  onChange,
  onCommit,
  step: requestedStep,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  max: number;
  /** Tapping a thumb without dragging opens a numeric field for that phase's
   *  duration — the number the control shows, not its cumulative boundary. */
  numericEntry?: boolean;
  onChange: (value: EnvelopeDurations) => void;
  onCommit?: (value: EnvelopeDurations) => void;
  step: number;
  value: EnvelopeDurations;
}) {
  const step = decimalStepGranularity(requestedStep);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<0 | 1 | 2 | null>(null);
  const precisionDragRef = useRef<PrecisionDrag | null>(null);
  const hapticsRef = useRef(new SliderHapticController());
  const currentRef = useRef<EnvelopeDurations>(value);
  const tapRef = useRef<SliderTapGesture | null>(null);
  const promoteRef = useRef<() => void>(() => undefined);
  const entry = useNumericEntry();
  const [interacting, setInteracting] = useState(false);
  currentRef.current = value;

  const boundaries = (durations: EnvelopeDurations): EnvelopeDurations => [
    durations[0],
    durations[0] + durations[1],
    durations[0] + durations[1] + durations[2],
  ];
  const stepped = useCallback((raw: number) => (
    Number(clamp(Math.round(raw / step) * step, 0, max).toFixed(12))
  ), [max, step]);
  const thumbPosition = (boundary: number, thumb: 0 | 1 | 2) => {
    const ratio = clamp(boundary / max, 0, 1);
    const pixelOffset = RECT_THUMB_WIDTH_PX * (thumb + 0.5) - ratio * RECT_THUMB_WIDTH_PX * 3;
    return `calc(${ratio * 100}% + ${pixelOffset}px)`;
  };
  // The hold and release durations a drag is trying to hold on to. Captured
  // when the drag starts so that compressing them against the end of the track
  // is undone on the way back, rather than being lost the moment it happens.
  const carriedRef = useRef<[hold: number, release: number]>([value[1], value[2]]);
  const update = useCallback((thumb: 0 | 1 | 2, raw: number, commit = false) => {
    const [before0, before1] = boundaries(currentRef.current);
    const [carriedHold, carriedRelease] = carriedRef.current;
    // Derived boundaries keep whatever precision the carried durations had;
    // only the dragged one is snapped to the step. `toFixed` just sheds the
    // float dust an addition leaves behind.
    const carry = (from: number, gap: number) => Number(clamp(from + gap, from, max).toFixed(12));
    let next: [number, number, number];
    if (thumb === 0) {
      const attackEnd = stepped(raw);
      const holdEnd = carry(attackEnd, carriedHold);
      next = [attackEnd, holdEnd, carry(holdEnd, carriedRelease)];
    } else if (thumb === 1) {
      const holdEnd = clamp(stepped(raw), before0, max);
      next = [before0, holdEnd, carry(holdEnd, carriedRelease)];
    } else {
      next = [before0, before1, clamp(stepped(raw), before1, max)];
    }
    // Durations are differences of boundaries, so they get the same float-dust
    // treatment — otherwise a 2s hold persists as 1.9999999999999998.
    const shed = (duration: number) => Number(duration.toFixed(12));
    const durations: EnvelopeDurations = [
      next[0],
      shed(next[1] - next[0]),
      shed(next[2] - next[1]),
    ];
    currentRef.current = durations;
    onChange(durations);
    if (commit) onCommit?.(durations);
    return next[thumb];
  }, [max, onChange, onCommit, step, stepped]);
  // Keyboard steps are one-off rather than a drag, so each takes the durations
  // as they stand now for the thumbs it carries.
  const carryFromCurrent = () => {
    carriedRef.current = [currentRef.current[1], currentRef.current[2]];
  };
  const rawFromPointer = (event: React.PointerEvent<HTMLDivElement>, thumb: 0 | 1 | 2) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const usableWidth = Math.max(1, rect.width - RECT_THUMB_WIDTH_PX * 3);
    return clamp((event.clientX - rect.left - RECT_THUMB_WIDTH_PX * (thumb + 0.5)) / usableWidth, 0, 1) * max;
  };
  const rawFromDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    const drag = precisionDragRef.current;
    if (!rect || !drag) return 0;
    const usableWidth = Math.max(1, rect.width - RECT_THUMB_WIDTH_PX * 3);
    return accumulatePrecisionDrag(drag, event.clientX, verticalDistanceOutside(event.clientY, rect), max / usableWidth);
  };
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentBoundaries = boundaries(currentRef.current);
    const centers = currentBoundaries.map((boundary, thumb) => {
      const ratio = boundary / max;
      return rect.left + ratio * (rect.width - RECT_THUMB_WIDTH_PX * 3) + RECT_THUMB_WIDTH_PX * (thumb + 0.5);
    });
    const thumb = centers.reduce<0 | 1 | 2>((closest, center, index) => (
      Math.abs(event.clientX - center) < Math.abs(event.clientX - centers[closest]) ? index as 0 | 1 | 2 : closest
    ), 0);
    activeThumbRef.current = thumb;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginControlInteraction();
    setInteracting(true);
    const startX = event.clientX;
    const raw = rawFromPointer(event, thumb);
    promoteRef.current = () => {
      carryFromCurrent();
      const nextBoundary = update(thumb, raw);
      hapticsRef.current.start({ value: nextBoundary, step });
      precisionDragRef.current = { currentValue: nextBoundary, lastX: startX };
    };
    tapRef.current = beginTap(event, () => promoteRef.current());
    if (!numericEntry) promoteTap(tapRef.current, () => promoteRef.current());
  };
  const end = () => {
    const thumb = activeThumbRef.current;
    if (thumb === null) return;
    const gesture = tapRef.current;
    tapRef.current = null;
    activeThumbRef.current = null;
    precisionDragRef.current = null;
    hapticsRef.current.stop();
    endControlInteraction();
    setInteracting(false);
    if (endedAsTap(gesture)) {
      openNumericEntry(thumb);
      return;
    }
    onCommit?.(currentRef.current);
  };
  const cancel = () => {
    cancelTapTimer(tapRef.current);
    tapRef.current = null;
    end();
  };
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>, thumb: 0 | 1 | 2) => {
    const current = boundaries(value)[thumb];
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + step;
    else if (event.key === "PageDown") next = current - step * 10;
    else if (event.key === "PageUp") next = current + step * 10;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = max;
    if (disabled || next === null) return;
    event.preventDefault();
    markControlInteraction();
    carryFromCurrent();
    update(thumb, next, true);
    selectionHaptic();
  };
  const currentBoundaries = boundaries(value);
  const phaseNames = ["attack", "hold", "release"] as const;
  const phaseAbbreviations = ["ATK", "HLD", "REL"] as const;

  // The field edits the phase *duration* — the number printed above the thumb —
  // rather than the cumulative boundary the drag maths work in. Its ceiling is
  // whatever room is left after the phases before it.
  const openNumericEntry = (thumb: 0 | 1 | 2) => {
    const track = trackRef.current;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    const start = boundaries(currentRef.current)[thumb - 1] ?? 0;
    const boundary = boundaries(currentRef.current)[thumb];
    const ratio = clamp(boundary / max, 0, 1);
    entry.open({
      anchor: track,
      anchorOffsetX: ratio * (width - RECT_THUMB_WIDTH_PX * 3) + RECT_THUMB_WIDTH_PX * (thumb + 0.5),
      label: `${ariaLabel} ${phaseNames[thumb]}`,
      max: Number((max - start).toFixed(12)),
      min: 0,
      onCommit: (duration) => {
        markControlInteraction();
        carryFromCurrent();
        update(thumb, start + duration, true);
      },
      step,
      value: currentRef.current[thumb],
    });
  };

  return (
    <>
    <div ref={trackRef} className={classNames("rect-slider rect-envelope-slider relative flex h-12 w-full items-center touch-none select-none", interacting && "rect-slider-active", disabled && "rect-slider-disabled")}
      onPointerDown={begin}
      onPointerMove={(event) => {
        if (activeThumbRef.current !== null && event.buttons === 1) {
          // Nothing has been applied while the press might still be a tap, so
          // dragging from the unseeded accumulator would jump to nonsense.
          if (!observeTap(tapRef.current, event, () => promoteRef.current())) return;
          const thumb = activeThumbRef.current;
          const rect = trackRef.current?.getBoundingClientRect();
          const dragBefore = precisionDragRef.current;
          const previousX = dragBefore?.lastX;
          const raw = rawFromDrag(event);
          const drag = precisionDragRef.current;
          const current = boundaries(currentRef.current);
          // A carried thumb never limits the dragged one, so the accumulator
          // stops only at the thumb it cannot push: the one to its left.
          if (drag) drag.currentValue = clamp(raw, current[thumb - 1] ?? 0, max);
          const nextBoundary = update(thumb, raw);
          if (rect && dragBefore) {
            hapticsRef.current.move(
              Math.abs(event.clientX - (previousX ?? event.clientX)) * precisionDragScale(verticalDistanceOutside(event.clientY, rect)) / Math.max(1, rect.width - RECT_THUMB_WIDTH_PX * 3),
              { value: nextBoundary },
            );
          }
        }
      }}
      onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={end}>
      <div className="rect-slider-track" />
      {([0, 1, 2] as const).map((thumb) => (
        <Fragment key={thumb}>
        <span className="rect-envelope-value" style={{ left: thumbPosition(currentBoundaries[thumb], thumb) }} aria-hidden="true">{formatEnvelopeSeconds(value[thumb])}</span>
        <span className="rect-envelope-label" style={{ left: thumbPosition(currentBoundaries[thumb], thumb) }} aria-hidden="true">{phaseAbbreviations[thumb]}</span>
        <div role="slider" tabIndex={disabled ? -1 : 0}
          aria-label={`${ariaLabel} ${phaseNames[thumb]} end`}
          aria-disabled={disabled}
          aria-valuemin={currentBoundaries[thumb - 1] ?? 0}
          aria-valuemax={max}
          aria-valuenow={currentBoundaries[thumb]}
          aria-valuetext={`${phaseNames[thumb]} ${value[thumb].toFixed(2).replace(/0$/, "")} seconds`}
          className={`rect-slider-thumb rect-range-thumb rect-envelope-thumb rect-envelope-thumb-${thumb + 1}`}
          style={{ left: thumbPosition(currentBoundaries[thumb], thumb) }}
          onKeyDown={(event) => keyboard(event, thumb)}
          onPointerDown={(event) => {
            activeThumbRef.current = thumb;
            event.stopPropagation();
            event.currentTarget.parentElement?.setPointerCapture?.(event.pointerId);
            beginControlInteraction();
            setInteracting(true);
            const startX = event.clientX;
            promoteRef.current = () => {
              carryFromCurrent();
              hapticsRef.current.start({ value: boundaries(currentRef.current)[thumb], step });
              precisionDragRef.current = { currentValue: boundaries(currentRef.current)[thumb], lastX: startX };
            };
            tapRef.current = beginTap(event, () => promoteRef.current());
            if (!numericEntry) promoteTap(tapRef.current, () => promoteRef.current());
          }} />
        </Fragment>
      ))}
    </div>
    {entry.element}
    </>
  );
}

export function DotSpectrumControl({
  ariaLabel,
  cursor,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  intensity = 100,
  onChange,
  onCommit,
  rgbAtPosition,
}: {
  ariaLabel: string;
  cursor: Cursor;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  intensity?: number;
  onChange: (cursor: Cursor, rgb: Rgb) => void;
  onCommit?: (cursor: Cursor, rgb: Rgb) => void;
  rgbAtPosition: (x: number, y: number) => Rgb;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dots, setDots] = useState<SpectrumDot[]>([]);
  const [dragging, setDragging] = useState(false);
  const hapticsRef = useRef(new SliderHapticController());
  const lastHapticCursorRef = useRef<Cursor | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { display: displayCursor, setLocal: setLocalCursor, release: releaseCursor } = useEasedCursor(cursor.x, cursor.y);
  const intensityScale = clamp(intensity / 100, 0, 1);

  const cursorX = insetPixel(displayCursor.x, size.width, SPECTRUM_CURSOR_INSET_PX);
  const cursorY = insetPixel(displayCursor.y, size.height, SPECTRUM_CURSOR_INSET_PX);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      const insetX = Math.min(SPECTRUM_CURSOR_INSET_PX, rect.width / 2);
      const insetY = Math.min(SPECTRUM_CURSOR_INSET_PX, rect.height / 2);
      const usableWidth = Math.max(0, rect.width - insetX * 2);
      const usableHeight = Math.max(0, rect.height - insetY * 2);
      const columns = Math.max(2, Math.round(usableWidth / DOT_GAP_PX) + 1);
      const rows = Math.max(2, Math.round(usableHeight / DOT_GAP_PX) + 1);
      const nextDots: SpectrumDot[] = [];

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = columns === 1 ? 0.5 : column / (columns - 1);
          const y = rows === 1 ? 0.5 : row / (rows - 1);
          nextDots.push({
            id: `color-${column}-${row}`,
            rgb: rgbAtPosition(x, y),
            x,
            xPx: insetPixel(x, rect.width, SPECTRUM_CURSOR_INSET_PX),
            y,
            yPx: insetPixel(y, rect.height, SPECTRUM_CURSOR_INSET_PX),
          });
        }
      }

      const edgeInset = DOT_GAP_PX;
      const edgeColumns = Math.max(0, Math.floor(Math.max(0, rect.width - edgeInset * 2) / DOT_GAP_PX) + 1);
      const edgeRows = Math.max(0, Math.floor(Math.max(0, rect.height - edgeInset * 2) / DOT_GAP_PX) + 1);
      const safeLeft = insetX;
      const safeRight = rect.width - insetX;
      const safeTop = insetY;
      const safeBottom = rect.height - insetY;

      for (let row = 0; row < edgeRows; row += 1) {
        for (let column = 0; column < edgeColumns; column += 1) {
          const xPx = edgeInset + column * DOT_GAP_PX;
          const yPx = edgeInset + row * DOT_GAP_PX;
          const outsideSafeArea = xPx < safeLeft || xPx > safeRight || yPx < safeTop || yPx > safeBottom;

          if (!outsideSafeArea) {
            continue;
          }

          nextDots.push({
            decorative: true,
            id: `edge-${column}-${row}`,
            rgb: DECORATIVE_SPECTRUM_DOT_RGB,
            x: pixelToInsetRatio(xPx, rect.width, SPECTRUM_CURSOR_INSET_PX),
            xPx,
            y: pixelToInsetRatio(yPx, rect.height, SPECTRUM_CURSOR_INSET_PX),
            yPx,
          });
        }
      }

      setSize({ width: rect.width, height: rect.height });
      setDots(nextDots);
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(pad);
    window.addEventListener("orientationchange", rebuild);

    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", rebuild);
    };
  }, [rgbAtPosition]);

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !padRef.current) {
      return;
    }

    const rect = padRef.current.getBoundingClientRect();
    const x = pixelToInsetRatio(event.clientX - rect.left, rect.width, SPECTRUM_CURSOR_INSET_PX);
    const y = pixelToInsetRatio(event.clientY - rect.top, rect.height, SPECTRUM_CURSOR_INSET_PX);
    const next = { x, y };
    const previous = lastHapticCursorRef.current;
    if (previous) hapticsRef.current.move(Math.hypot(x - previous.x, y - previous.y));
    lastHapticCursorRef.current = next;
    setLocalCursor(next);
    onChange(next, rgbAtPosition(x, y));
  };

  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    hapticsRef.current.stop();
    lastHapticCursorRef.current = null;
    const rect = padRef.current?.getBoundingClientRect();
    if (rect) {
      const x = pixelToInsetRatio(event.clientX - rect.left, rect.width, SPECTRUM_CURSOR_INSET_PX);
      const y = pixelToInsetRatio(event.clientY - rect.top, rect.height, SPECTRUM_CURSOR_INSET_PX);
      const next = { x, y };
      releaseCursor(next);
      onCommit?.(next, rgbAtPosition(x, y));
    } else {
      releaseCursor(cursor);
      onCommit?.(cursor, rgbAtPosition(cursor.x, cursor.y));
    }
  };

  return (
    <div
      ref={padRef}
      role="slider"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      data-demo-tooltip-title={demoTooltipTitle}
      data-demo-tooltip={demoTooltip}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => {
        if (disabled || isBottomGestureBlindSpot(event)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        hapticsRef.current.start();
        lastHapticCursorRef.current = null;
        pick(event);
      }}
      onPointerMove={(event) => {
        if (dragging && event.buttons === 1) {
          pick(event);
        }
      }}
      onPointerUp={stop}
      onPointerCancel={(event) => {
        setDragging(false);
        hapticsRef.current.stop();
        lastHapticCursorRef.current = null;
        releaseCursor(cursor);
        onCommit?.(cursor, rgbAtPosition(cursor.x, cursor.y));
      }}
      onLostPointerCapture={(event) => {
        if (dragging) stop(event);
      }}
      className={classNames(
        "spectrum-pad accent-spectrum-pad relative h-48 w-full touch-none overflow-hidden outline-none",
        disabled && "spectrum-pad-disabled",
      )}
    >
      <div className="spectrum-pad-bg absolute inset-0 bg-neutral-950/80" />
      <svg
        className="spectrum-svg pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${Math.max(size.width, 1)} ${Math.max(size.height, 1)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {dots.map((dot) => {
          const distance = Math.hypot(dot.xPx - cursorX, dot.yPx - cursorY);
          const dotSize = focusedDotScale(distance, DOT_INFLUENCE_RADIUS_PX);
          const rgb = dot.decorative
            ? DECORATIVE_SPECTRUM_DOT_RGB
            : disabled
              ? DISABLED_DOT_RGB
              : scaledRgb(dot.rgb, intensityScale);

          return (
            <circle
              key={dot.id}
              className="spectrum-svg-dot"
              cx={dot.xPx}
              cy={dot.yPx}
              r={svgDotRadius(dotSize)}
              fill={`rgb(${rgb.join(" ")})`}
              style={{ color: `rgb(${rgb.join(" ")})` }}
            />
          );
        })}
        {!disabled && (
          <g
            className={classNames("spectrum-svg-cursor", dragging && "spectrum-svg-cursor-dragging")}
            transform={`translate(${cursorX} ${cursorY}) rotate(-105)`}
          >
            <circle
              cx={0}
              cy={0}
              r={SVG_SPECTRUM_CURSOR_RADIUS_PX}
              strokeWidth={SVG_SPECTRUM_CURSOR_STROKE_PX}
              strokeDasharray="20 40"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
