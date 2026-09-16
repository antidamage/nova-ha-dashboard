"use client";

import { useCallback, useRef, useState } from "react";
import { decimalStepGranularity } from "../../../../lib/slider-step";
import {
  beginControlInteraction,
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
import {
  accumulatePrecisionDrag,
  clamp,
  classNames,
  precisionDragScale,
  verticalDistanceOutside,
} from "./dot-model";
import type { PrecisionDrag } from "./types";

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
