"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decimalStepGranularity } from "../../../../lib/slider-step";
import {
  beginControlInteraction,
  CONTROL_INTERACTION_COOLDOWN_MS,
  endControlInteraction,
  markControlInteraction,
} from "../../controlInteractionCooldown";
import { selectionHaptic, SliderHapticController } from "../../haptics";
import { useNumericEntry } from "../../NumericEntryPopover";
import {
  beginTap,
  cancelTapTimer,
  endedAsTap,
  observeTap,
  promoteTap,
  type SliderTapGesture,
} from "../../sliderTapGesture";
import { RECT_THUMB_WIDTH_PX } from "./constants";
import {
  accumulatePrecisionDrag,
  clamp,
  classNames,
  insetPercent,
  insetPixel,
  precisionDragScale,
  verticalDistanceOutside,
} from "./dot-model";
import type { DotColor, PrecisionDrag } from "./types";
import { useRemoteEasedNumber } from "./useRemoteEasedNumber";

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
