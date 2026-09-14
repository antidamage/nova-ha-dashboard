/**
 * The Advanced fold's rubber band: constants and pure maths, kept apart from
 * the component so they can be tested without a layout. See
 * specs/advanced-fold.md, "The gesture".
 */

/** Input travel, in px, at which the band breaks and Advanced opens. */
export const ADVANCED_FOLD_BREAK_PX = 80;
/** The furthest the content moves while the band holds, reached at the break. */
export const ADVANCED_FOLD_BAND_MAX_PX = 28;
/** Spring back to rest after a release short of the break. */
export const ADVANCED_FOLD_SPRING_BACK_MS = 180;
export const ADVANCED_FOLD_SPRING_BACK_EASING = "ease-out";
/** Rubber-band forward to the 1:1 position after the break. */
export const ADVANCED_FOLD_BREAK_MS = 220;
export const ADVANCED_FOLD_BREAK_EASING = "cubic-bezier(0.2, 0.9, 0.3, 1.15)";
/** A wheel counts at this fraction of its pixel delta. */
export const ADVANCED_FOLD_WHEEL_FACTOR = 0.25;
/** A wheel pull decays once the wheel has been still this long. */
export const ADVANCED_FOLD_WHEEL_IDLE_MS = 400;
/** Touch decides whether it is travelling along the fold's axis within this distance. */
export const ADVANCED_FOLD_TOUCH_AXIS_PX = 8;
/** Pixels per wheel line when `deltaMode` is DOM_DELTA_LINE. */
export const WHEEL_LINE_PX = 16;

/**
 * How far the content moves for `pull` px of input while the band holds:
 * `28 × (1 − (1 − p/80)²)`. Slope 0.7 at rest, flat at the break.
 */
export function bandDisplacement(pull: number): number {
  const p = Math.min(Math.max(pull, 0), ADVANCED_FOLD_BREAK_PX);
  const remaining = 1 - p / ADVANCED_FOLD_BREAK_PX;
  return ADVANCED_FOLD_BAND_MAX_PX * (1 - remaining * remaining);
}

/** True once the accumulated pull has broken the band. */
export function bandBroken(pull: number): boolean {
  return pull >= ADVANCED_FOLD_BREAK_PX;
}

/**
 * The offset the break lands on: where the content would be had it followed
 * the input 1:1 the whole way, clamped to the scroll range.
 */
export function breakOffset(boundary: number, pull: number, maxOffset: number): number {
  return Math.min(Math.max(boundary + pull, 0), Math.max(maxOffset, 0));
}

/** A wheel delta in pixels, whatever its `deltaMode`. `pagePx` is the sub-panel's size. */
export function wheelDeltaPx(delta: number, deltaMode: number, pagePx: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * pagePx;
  return delta;
}

/**
 * The part of a wheel event that travels along the fold's axis. Portrait folds
 * take only `deltaX`: a vertical wheel over one always scrolls the page.
 */
export function wheelAxisDelta(axis: "x" | "y", deltaX: number, deltaY: number): number {
  if (axis === "x") return deltaX;
  // Landscape: a mostly-sideways wheel is the page's pan, not a pull.
  return Math.abs(deltaX) > Math.abs(deltaY) ? 0 : deltaY;
}

/**
 * Whether a drag starting on `target` belongs to a control with its own drag,
 * walking up to `root` and no further. Not `startsInNonDraggable`, which also
 * rejects any overflowing scroller — and the fold is one.
 */
export function startsOnOwnDragControl(target: EventTarget | null, root: Element | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node.hasAttribute("data-nova-no-drag-scroll")) return true;
    if (node.classList.contains("maplibregl-map")) return true;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") return true;
    const role = node.getAttribute("role");
    if (role === "slider" || role === "switch") return true;
    const editable = node.getAttribute("contenteditable");
    if (editable === "" || editable === "true" || editable === "plaintext-only") return true;
    if (node === root) return false;
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether `target` sits inside a scroller of its own, strictly below `root`,
 * that can scroll along the fold's axis. That scroller owns the drag, not the
 * fold.
 */
export function startsInInnerScroller(target: EventTarget | null, root: Element | null, axis: "x" | "y"): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflow = axis === "y" ? style.overflowY : style.overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        const room = axis === "y"
          ? node.scrollHeight - node.clientHeight
          : node.scrollWidth - node.clientWidth;
        if (room > 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}
