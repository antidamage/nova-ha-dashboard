"use client";

import { useEffect, useRef, useState } from "react";
import { SliderHapticController } from "../../haptics";
import {
  DECORATIVE_SPECTRUM_DOT_RGB,
  DISABLED_DOT_RGB,
  DOT_GAP_PX,
  DOT_INFLUENCE_RADIUS_PX,
  SPECTRUM_CURSOR_INSET_PX,
  SVG_SPECTRUM_CURSOR_RADIUS_PX,
  SVG_SPECTRUM_CURSOR_STROKE_PX,
} from "./constants";
import {
  clamp,
  classNames,
  focusedDotScale,
  insetPixel,
  isBottomGestureBlindSpot,
  pixelToInsetRatio,
  scaledRgb,
  svgDotRadius,
} from "./dot-model";
import type { Cursor, Rgb, SpectrumDot } from "./types";
import { useEasedCursor } from "./useEasedCursor";

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
