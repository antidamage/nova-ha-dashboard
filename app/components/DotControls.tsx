"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Rgb = [number, number, number];
type Cursor = { x: number; y: number };

const DOT_GAP_PX = 15;
const LINE_CURSOR_INSET_PX = 18;
const SPECTRUM_CURSOR_INSET_PX = 40;
const DOT_INFLUENCE_RADIUS_PX = 78;
const SVG_DOT_RADIUS_PX = 0.5;
const SVG_LINE_HEIGHT_PX = 48;
const SVG_LINE_CENTER_Y_PX = SVG_LINE_HEIGHT_PX / 2;
const SVG_LINE_CURSOR_RADIUS_PX = 16.5;
const SVG_LINE_CURSOR_STROKE_PX = 3;
const SVG_SPECTRUM_CURSOR_RADIUS_PX = 38;
const SVG_SPECTRUM_CURSOR_STROKE_PX = 3;
const REMOTE_EASE_MS = 1000;

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

function insetPercent(value: number, length: number, insetPx: number) {
  return length > 0 ? (insetPixel(value, length, insetPx) / length) * 100 : clamp(value, 0, 1) * 100;
}

function focusedDotScale(distance: number, radius: number) {
  const weight = clamp(1 - distance / radius, 0, 1);
  const eased = weight * weight * (3 - 2 * weight);
  return Math.round((1 + eased * 5) * 100) / 100;
}

function svgDotRadius(scale: number) {
  return Math.round(SVG_DOT_RADIUS_PX * scale * 100) / 100;
}

function useRemoteEasedNumber(target: number) {
  const [displayValue, setDisplayValue] = useState(target);
  const displayValueRef = useRef(target);
  const localInteractionRef = useRef(false);
  const animationRef = useRef<number | null>(null);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
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
    if (Math.abs(target - start) < 0.01) {
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
        animationRef.current = window.requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        displayValueRef.current = target;
        setDisplayValue(target);
      }
    };

    animationRef.current = window.requestAnimationFrame(animate);
  }, [cancelAnimation, target]);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  return { displayValue, releaseLocalValue, setLocalValue };
}

export function DotLineControl({
  activeColor,
  ariaLabel,
  ariaValueText,
  color,
  disabled = false,
  markers,
  max = 100,
  min = 0,
  onChange,
  onCommit,
  step = 1,
  value,
}: {
  activeColor?: Rgb;
  ariaLabel: string;
  ariaValueText?: string;
  color: Rgb;
  disabled?: boolean;
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
  const [dotCount, setDotCount] = useState(2);
  const [interacting, setInteracting] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  const { displayValue, releaseLocalValue, setLocalValue } = useRemoteEasedNumber(value);
  const range = Math.max(step, max - min);
  const displayRatio = clamp((displayValue - min) / range, 0, 1);
  const displayCursorX = insetPixel(displayRatio, lineWidth, LINE_CURSOR_INSET_PX);
  const endpoint = interacting && activeColor ? activeColor : color;

  useEffect(() => {
    commitValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      setLineWidth(rect.width);
      setDotCount(Math.max(2, Math.round(rect.width / DOT_GAP_PX) + 1));
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

  const dots = Array.from({ length: dotCount }, (_, index) => {
    const amount = dotCount <= 1 ? 0 : index / (dotCount - 1);
    return {
      amount,
      opacity: amount * 0.96,
      rgb: endpoint,
      xPx: amount * lineWidth,
    };
  });

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
        "intensity-dot-pad relative h-12 w-full touch-none overflow-hidden outline-none",
        disabled && "intensity-dot-pad-disabled",
      )}
    >
      <svg
        className="dot-line-svg pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${Math.max(lineWidth, 1)} ${SVG_LINE_HEIGHT_PX}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {dots.map((dot, index) => {
          const size = focusedDotScale(Math.abs(dot.xPx - displayCursorX), DOT_INFLUENCE_RADIUS_PX);

          return (
            <circle
              key={index}
              className="dot-line-svg-dot"
              cx={dot.xPx}
              cy={SVG_LINE_CENTER_Y_PX}
              r={svgDotRadius(size)}
              fill={`rgb(${dot.rgb.join(" ")})`}
              opacity={dot.opacity}
            />
          );
        })}
        <g
          className={classNames("dot-line-svg-cursor", interacting && "dot-line-svg-cursor-active")}
          transform={`translate(${displayCursorX} ${SVG_LINE_CENTER_Y_PX}) rotate(-120)`}
        >
          <circle
            cx={0}
            cy={0}
            r={SVG_LINE_CURSOR_RADIUS_PX}
            strokeWidth={SVG_LINE_CURSOR_STROKE_PX}
            strokeDasharray="17.3 34.6"
          />
        </g>
      </svg>
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
              style={{ left: `${insetPercent(markerRatio, lineWidth, LINE_CURSOR_INSET_PX)}%` }}
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
  onChange,
  rgbAtPosition,
}: {
  ariaLabel: string;
  cursor: Cursor;
  onChange: (cursor: Cursor, rgb: Rgb) => void;
  rgbAtPosition: (x: number, y: number) => Rgb;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dots, setDots] = useState<Array<{ id: string; rgb: Rgb; x: number; xPx: number; y: number; yPx: number }>>([]);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const cursorX = insetPixel(cursor.x, size.width, SPECTRUM_CURSOR_INSET_PX);
  const cursorY = insetPixel(cursor.y, size.height, SPECTRUM_CURSOR_INSET_PX);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad) {
      return;
    }

    const rebuild = () => {
      const rect = pad.getBoundingClientRect();
      const columns = Math.max(2, Math.round(rect.width / DOT_GAP_PX) + 1);
      const rows = Math.max(2, Math.round(rect.height / DOT_GAP_PX) + 1);
      const nextDots: Array<{ id: string; rgb: Rgb; x: number; xPx: number; y: number; yPx: number }> = [];

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = columns === 1 ? 0.5 : column / (columns - 1);
          const y = rows === 1 ? 0.5 : row / (rows - 1);
          nextDots.push({
            id: `${column}-${row}`,
            rgb: rgbAtPosition(x, y),
            x,
            xPx: x * rect.width,
            y,
            yPx: y * rect.height,
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
    if (!padRef.current) {
      return;
    }

    const rect = padRef.current.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    onChange({ x, y }, rgbAtPosition(x, y));
  };

  return (
    <div
      ref={padRef}
      role="slider"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) {
          pick(event);
        }
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      className="spectrum-pad accent-spectrum-pad relative h-48 w-full touch-none overflow-hidden outline-none"
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

          return (
            <circle
              key={dot.id}
              className="spectrum-svg-dot"
              cx={dot.xPx}
              cy={dot.yPx}
              r={svgDotRadius(dotSize)}
              fill={`rgb(${dot.rgb.join(" ")})`}
            />
          );
        })}
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
      </svg>
    </div>
  );
}
