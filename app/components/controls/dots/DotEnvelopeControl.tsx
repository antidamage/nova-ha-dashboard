"use client";

import { Fragment, useCallback, useRef, useState } from "react";
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
import { RECT_THUMB_WIDTH_PX } from "./constants";
import {
  accumulatePrecisionDrag,
  clamp,
  classNames,
  formatEnvelopeSeconds,
  precisionDragScale,
  verticalDistanceOutside,
} from "./dot-model";
import type { EnvelopeDurations, PrecisionDrag } from "./types";

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
