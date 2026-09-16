/**
 * The Advanced fold's rubber band: constants and pure maths, kept apart from
 * the component so they can be tested without a layout. See
 * specs/advanced-fold.md, "The gesture" and "Round 2".
 */

/** Which input is pulling: touch and mouse drags share one band, the wheel has its own. */
export type FoldBand = "drag" | "wheel";

/** Drag (touch or mouse) input travel, in px, at which the band breaks. */
export const ADVANCED_FOLD_DRAG_BREAK_PX = 160;
/** The furthest a drag moves the content while the band holds. */
export const ADVANCED_FOLD_DRAG_BAND_MAX_PX = 14;
/** Wheel travel (after the quarter factor), in px, at which the band breaks. */
export const ADVANCED_FOLD_WHEEL_BREAK_PX = 80;
/** The furthest the wheel moves the content while the band holds. */
export const ADVANCED_FOLD_WHEEL_BAND_MAX_PX = 28;
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
/**
 * A drag does nothing until it has travelled this far, so a tap stays a tap;
 * touch also decides its axis here.
 */
export const ADVANCED_FOLD_TOUCH_AXIS_PX = 8;
/** Pixels per wheel line when `deltaMode` is DOM_DELTA_LINE. */
export const WHEEL_LINE_PX = 16;

export function bandBreakPx(band: FoldBand): number {
  return band === "drag" ? ADVANCED_FOLD_DRAG_BREAK_PX : ADVANCED_FOLD_WHEEL_BREAK_PX;
}

export function bandMaxPx(band: FoldBand): number {
  return band === "drag" ? ADVANCED_FOLD_DRAG_BAND_MAX_PX : ADVANCED_FOLD_WHEEL_BAND_MAX_PX;
}

/**
 * How far the content moves for `pull` px of input while the band holds:
 * `max × (1 − (1 − p/break)²)` — 14 px over 160 for a drag, 28 px over 80 for
 * the wheel. Flat at the break.
 */
export function bandDisplacement(pull: number, band: FoldBand): number {
  const breakPx = bandBreakPx(band);
  const p = Math.min(Math.max(pull, 0), breakPx);
  const remaining = 1 - p / breakPx;
  return bandMaxPx(band) * (1 - remaining * remaining);
}

/** True once the accumulated pull has broken the band. */
export function bandBroken(pull: number, band: FoldBand): boolean {
  return pull >= bandBreakPx(band);
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
 * Whether a drag starting on `target` belongs to a control with its own press
 * or drag (buttons, links, fields, sliders, switches, maps),
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
    if (tag === "BUTTON" || (tag === "A" && node.hasAttribute("href"))) return true;
    const role = node.getAttribute("role");
    if (role === "slider" || role === "switch" || role === "button") return true;
    const editable = node.getAttribute("contenteditable");
    if (editable === "" || editable === "true" || editable === "plaintext-only") return true;
    if (node === root) return false;
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether `target` sits inside a scroller of its own, strictly below `root`,
 * that can still scroll along the fold's axis. That scroller owns the drag, not
 * the fold. With a `direction` (positive: toward Advanced, i.e. a growing
 * offset) only room in that direction counts; without one, any room does.
 */
export function startsInInnerScroller(
  target: EventTarget | null,
  root: Element | null,
  axis: "x" | "y",
  direction = 0,
): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflow = axis === "y" ? style.overflowY : style.overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        const size = axis === "y" ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
        const offset = axis === "y" ? node.scrollTop : node.scrollLeft;
        const room = direction > 0 ? size - offset : direction < 0 ? offset : size;
        if (size > 1 && room > 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

/** A flick keeps this fraction of its velocity each 60fps frame after the finger lifts. */
export const ADVANCED_FOLD_INERTIA_FRICTION = 0.95;
/** A flick stops once it is slower than this, in px per 60fps frame. */
export const ADVANCED_FOLD_INERTIA_STOP = 0.05;
/** The release velocity is measured over this much of the gesture's end. */
export const ADVANCED_FOLD_INERTIA_WINDOW_MS = 100;
const FRAME_MS = 1000 / 60;

/**
 * Release velocity in px per 60fps frame from `(time, position)` samples of
 * travel toward Advanced, using those within the last 100ms. Zero with fewer
 * than two samples in the window.
 */
export function flickVelocity(samples: ReadonlyArray<{ time: number; pos: number }>): number {
  if (samples.length < 2) return 0;
  const end = samples[samples.length - 1];
  let first = end;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (end.time - samples[i].time > ADVANCED_FOLD_INERTIA_WINDOW_MS) break;
    first = samples[i];
  }
  const dt = end.time - first.time;
  if (dt <= 0) return 0;
  return ((end.pos - first.pos) / dt) * FRAME_MS;
}

/**
 * One inertia step for `elapsedMs` of wall time: the distance to travel and the
 * velocity left, with friction scaled to the frame length. `velocity` is 0 once
 * it falls under the stop speed.
 */
export function inertiaStep(velocity: number, elapsedMs = FRAME_MS): { distance: number; velocity: number } {
  const frames = Math.max(0, elapsedMs) / FRAME_MS;
  const next = velocity * Math.pow(ADVANCED_FOLD_INERTIA_FRICTION, frames);
  const distance = velocity * frames;
  return { distance, velocity: Math.abs(next) < ADVANCED_FOLD_INERTIA_STOP ? 0 : next };
}
