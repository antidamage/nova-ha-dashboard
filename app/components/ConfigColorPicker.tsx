"use client";

import { useEffect, useRef, useState } from "react";
import {
  beginControlInteraction,
  CONTROL_INTERACTION_COOLDOWN_MS,
  endControlInteraction,
} from "./controlInteractionCooldown";

type Cursor = { x: number; y: number };
type Rgb = [number, number, number];

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Static colour spectrum used only by configuration editors. Unlike the live
 * lighting picker this deliberately has no generated dots or eased cursor: a
 * colour change is immediate and the full surface remains selectable.
 */
export function ConfigColorPicker({
  ariaLabel,
  cursor,
  demoTooltip,
  demoTooltipTitle,
  disabled = false,
  onChange,
  onCommit,
  rgbAtPosition,
}: {
  ariaLabel: string;
  cursor: Cursor;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  onChange: (cursor: Cursor, rgb: Rgb) => void;
  onCommit?: (cursor: Cursor, rgb: Rgb) => void;
  rgbAtPosition: (x: number, y: number) => Rgb;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [displayCursor, setDisplayCursor] = useState(cursor);
  const [releaseRevision, setReleaseRevision] = useState(0);
  const draggingRef = useRef(false);
  const latestLocalCursorRef = useRef(cursor);
  const remoteHoldUntilRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (draggingRef.current || Date.now() < remoteHoldUntilRef.current) {
      return;
    }
    latestLocalCursorRef.current = cursor;
    setDisplayCursor(cursor);
  }, [cursor, releaseRevision]);

  useEffect(() => () => {
    if (draggingRef.current) {
      draggingRef.current = false;
      endControlInteraction();
    }
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
  }, []);

  const positionFor = (event: React.PointerEvent<HTMLDivElement>): Cursor | null => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = positionFor(event);
    if (next) {
      latestLocalCursorRef.current = next;
      setDisplayCursor(next);
      onChange(next, rgbAtPosition(next.x, next.y));
    }
  };

  const commit = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    draggingRef.current = false;
    setDragging(false);
    endControlInteraction();
    const next = (event ? positionFor(event) : null) ?? latestLocalCursorRef.current;
    latestLocalCursorRef.current = next;
    setDisplayCursor(next);
    remoteHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null;
      setReleaseRevision((current) => current + 1);
    }, CONTROL_INTERACTION_COOLDOWN_MS);
    onCommit?.(next, rgbAtPosition(next.x, next.y));
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
      className={`config-color-picker dashboard-spectrum-selector relative w-full touch-none select-none overflow-hidden outline-none ${disabled ? "config-color-picker-disabled" : ""}`}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginControlInteraction();
        draggingRef.current = true;
        remoteHoldUntilRef.current = Number.POSITIVE_INFINITY;
        setDragging(true);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current && event.buttons === 1) pick(event);
      }}
      onPointerUp={commit}
      onPointerCancel={() => {
        if (!draggingRef.current) return;
        commit();
      }}
      onLostPointerCapture={commit}
    >
      <div className="config-color-picker-spectrum absolute inset-0" aria-hidden="true" />
      {!disabled ? (
        <span
          className={`config-color-picker-reticle pointer-events-none absolute ${dragging ? "config-color-picker-reticle-dragging" : ""}`}
          style={{ left: `${clamp(displayCursor.x) * 100}%`, top: `${clamp(displayCursor.y) * 100}%` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
