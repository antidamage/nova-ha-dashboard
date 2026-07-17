"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiteMode } from "./dashboard/experienceModeSetting";

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

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
function useRemoteEasedNumber(target: number) {
  const lite = useLiteMode();
  const [displayValue, setDisplayValue] = useState(target);
  const displayValueRef = useRef(target);
  const localInteractionRef = useRef(false);
  const animationRef = useRef<number | null>(null);

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
      localInteractionRef.current = true;
      setImmediate(next);
    },
    [setImmediate],
  );

  const releaseLocalValue = useCallback(
    (next: number) => {
      setImmediate(next);
      localInteractionRef.current = false;
    },
    [setImmediate],
  );

  useEffect(() => {
    if (localInteractionRef.current) {
      displayValueRef.current = target;
      setDisplayValue(target);
      return;
    }

    cancelAnimation();
    const start = displayValueRef.current;
    if (lite || Math.abs(target - start) < 0.01) {
      displayValueRef.current = target;
      setDisplayValue(target);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / REMOTE_EASE_MS, 0, 1);
      const next = start + (target - start) * easeOut(progress);
      displayValueRef.current = next;
      setDisplayValue(next);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        displayValueRef.current = target;
        setDisplayValue(target);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [cancelAnimation, lite, target]);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  return { displayValue, releaseLocalValue, setLocalValue };
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
  onChange,
  onCommit,
  step = 1,
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
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  step?: number;
  value: number;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const commitValueRef = useRef(value);
  const draggingRef = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  const { displayValue, releaseLocalValue, setLocalValue } = useRemoteEasedNumber(value);
  const range = Math.max(step, max - min);
  const displayRatio = clamp((displayValue - min) / range, 0, 1);
  // Thumb centre is inset by half its width so it never overflows the track ends;
  // the accent back-fill (when enabled) stops at that centre.
  const thumbCenterPx = insetPixel(displayRatio, lineWidth, RECT_THUMB_WIDTH_PX / 2);

  useEffect(() => {
    commitValueRef.current = value;
  }, [value]);

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
    },
    [onChange, roundToStep, setLocalValue],
  );

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !padRef.current) {
        return;
      }

      const rect = padRef.current.getBoundingClientRect();
      setControlValue(min + ((event.clientX - rect.left) / rect.width) * range);
    },
    [disabled, min, range, setControlValue],
  );

  const commit = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    setInteracting(false);
    releaseLocalValue(commitValueRef.current);
    onCommit?.(commitValueRef.current);
  }, [onCommit, releaseLocalValue]);

  const keyStep = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, next: number) => {
      event.preventDefault();
      const stepped = roundToStep(next);
      setControlValue(stepped);
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
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = true;
        setInteracting(true);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) {
          pick(event);
        }
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onLostPointerCapture={commit}
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
    return slider;
  }

  return (
    <>
      {slider}
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
    setLocalCursor(next);
    onChange(next, rgbAtPosition(x, y));
  };

  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
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
