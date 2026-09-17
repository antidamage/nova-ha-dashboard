// Pure maths for the map's mouse, wheel and keyboard handling.
import { MIN_CENTER_ROTATE_SCALE, PAN_PX } from "./constants";

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
export function dampValue(current: number, target: number, deltaSeconds: number, easeSeconds: number) {
  if (easeSeconds <= 0) {
    return target;
  }

  const amount = 1 - Math.exp(-deltaSeconds / easeSeconds);
  return current + (target - current) * amount;
}

export function clampDelta(current: number, target: number, maxDelta: number) {
  if (maxDelta <= 0) {
    return current;
  }

  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return current + Math.sign(delta) * maxDelta;
}

export function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, shiftKey: boolean) {
  const delta = deltaMode === WheelEvent.DOM_DELTA_LINE ? deltaY * 40 : deltaY;
  return shiftKey ? delta / 4 : delta;
}
export function frameDeltaSeconds(currentTime: number, previousTime: number | null) {
  if (previousTime === null) {
    return 1 / 60;
  }

  return Math.max(0, Math.min(0.12, (currentTime - previousTime) / 1000));
}

export function isPanKey(key: string) {
  return key === "w" || key === "a" || key === "s" || key === "d";
}

export function getCameraRelativePanOffset(keys: Set<string>): [number, number] {
  let dx = 0;
  let dy = 0;

  if (keys.has("w")) {
    dy -= PAN_PX;
  }
  if (keys.has("s")) {
    dy += PAN_PX;
  }
  if (keys.has("a")) {
    dx -= PAN_PX;
  }
  if (keys.has("d")) {
    dx += PAN_PX;
  }

  return [dx, dy];
}

export function getCenterRotationScale(rect: DOMRect, clientX: number, clientY: number) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDistance = Math.hypot(rect.width / 2, rect.height / 2) || 1;
  const distanceFromCenter = Math.hypot(clientX - centerX, clientY - centerY);
  const distanceRatio = Math.min(distanceFromCenter / maxDistance, 1);

  return MIN_CENTER_ROTATE_SCALE + distanceRatio * (1 - MIN_CENTER_ROTATE_SCALE);
}
