/** Small helpers for RotaryEncoder: clamping, the clock, turn maths, surface tint and the annulus clip. */

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** `target` plus the whole turns that land it nearest `from`: the short way round. */
export function nearestTurn(target: number, from: number) {
  return target + 360 * Math.round((from - target) / 360);
}

/** Light or dark, from the tint the knob is actually painted in. */
export function isLightSurface(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return false;
  const parsed = window.getComputedStyle(element).color.match(/[\d.]+/g);
  if (!parsed || parsed.length < 3) return false;
  const [r, g, b] = parsed.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/**
 * An evenodd clip that drops the knob's disc and keeps everything outside it.
 *
 * The outer edge sits well beyond the footprint: the outermost ring's curved
 * label, value text and thumb shadow reach past the footprint's inscribed
 * circle at 7:30 and 4:30, and an outer edge at the footprint radius cut them
 * off at the bottom left and right (specs/temperature-encoder.md, round 2).
 */
export function annulusClip(footprint: number, holeRadius: number) {
  const c = footprint / 2;
  const ring = (radius: number) =>
    `M ${c - radius} ${c} A ${radius} ${radius} 0 1 0 ${c + radius} ${c} A ${radius} ${radius} 0 1 0 ${c - radius} ${c} Z`;
  return `path(evenodd, "${ring(c * 2)} ${ring(holeRadius)}")`;
}
