export type NormalizedPoint = { x: number; y: number };
export type NormalizedRectangle = { x: number; y: number; width: number; height: number };

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function normalizedRectangle(start: NormalizedPoint, end: NormalizedPoint): NormalizedRectangle {
  const startX = clamp(start.x);
  const startY = clamp(start.y);
  const endX = clamp(end.x);
  const endY = clamp(end.y);
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function isUsableReferenceSelection(rectangle: NormalizedRectangle | null, minimumFraction = 0.02) {
  return rectangle !== null && rectangle.width >= minimumFraction && rectangle.height >= minimumFraction;
}
