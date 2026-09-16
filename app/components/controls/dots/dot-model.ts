/** Pure helpers for the Dot* controls: precision drag, easing, inset maths, dot scaling. */
import {
  IOS_BOTTOM_GESTURE_BLIND_SPOT_PX,
  PRECISION_DRAG_DEAD_ZONE_PX,
  PRECISION_DRAG_FULL_EFFECT_PX,
  PRECISION_DRAG_MIN_SCALE,
  SVG_DOT_RADIUS_PX,
} from "./constants";
import type { PrecisionDrag, Rgb } from "./types";

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
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

export function verticalDistanceOutside(clientY: number, rect: Pick<DOMRect, "bottom" | "top">) {
  return Math.max(rect.top - clientY, clientY - rect.bottom, 0);
}

export function accumulatePrecisionDrag(drag: PrecisionDrag, clientX: number, verticalDistance: number, valuePerPixel: number) {
  const scale = precisionDragScale(verticalDistance);
  drag.currentValue += (clientX - drag.lastX) * valuePerPixel * scale;
  drag.lastX = clientX;
  return drag.currentValue;
}

export function easeOut(value: number) {
  const smoothProgress = value * value * (3 - 2 * value);
  return 1 - Math.pow(1 - smoothProgress, 2.25);
}

export function insetPixel(value: number, length: number, insetPx: number) {
  if (length <= 0) {
    return clamp(value, 0, 1) * length;
  }

  const inset = Math.min(insetPx, length / 2);
  return inset + clamp(value, 0, 1) * Math.max(0, length - inset * 2);
}

export function pixelToInsetRatio(pixel: number, length: number, insetPx: number) {
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

export function insetPercent(value: number, length: number, insetPx: number) {
  return length > 0 ? (insetPixel(value, length, insetPx) / length) * 100 : clamp(value, 0, 1) * 100;
}

export function focusedDotScale(distance: number, radius: number) {
  const weight = clamp(1 - distance / radius, 0, 1);
  // Quartic falloff: concentrates magnification near the cursor, drops off fast toward the edge
  const eased = weight * weight * weight * weight;
  const base = 1 + eased * 5.5;

  // Sharp centre spike: 4× normal max at distance 0, cubic falloff over ~12px
  const spikeWeight = clamp(1 - distance / 12, 0, 1);
  const spike = spikeWeight * spikeWeight * spikeWeight * 8.5;

  return Math.round((base + spike) * 100) / 100;
}

export function svgDotRadius(scale: number) {
  return Math.round(SVG_DOT_RADIUS_PX * scale * 100) / 100;
}

export function scaledRgb(rgb: Rgb, scale: number): Rgb {
  return rgb.map((part) => clamp(Math.round(part * scale), 0, 255)) as Rgb;
}

export function isBottomGestureBlindSpot(event: React.PointerEvent<HTMLElement>) {
  if (typeof window === "undefined" || event.pointerType === "mouse") {
    return false;
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  return event.clientY >= Math.max(0, viewportHeight - IOS_BOTTOM_GESTURE_BLIND_SPOT_PX);
}

export function formatEnvelopeSeconds(value: number) {
  return `${value.toFixed(2).replace(/0$/, "")}s`;
}
