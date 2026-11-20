/**
 * Tutorial mode's layout maths (specs/tutorial-mode.md, "The mask" and
 * "Placement"). Pure: every input is a rect or a size, so it is tested without
 * a DOM.
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

/** The margin round a control inside the cut-out, and the cut-out's corner. */
export const CUTOUT_MARGIN = 12;
export const CUTOUT_RADIUS = 18;
/** The fixed bottom bar: at least 56px, plus the safe area. */
export const BAR_HEIGHT = 64;
export const PANEL_GAP = 16;
export const VIEWPORT_GUTTER = 16;

export function cutoutFor(rect: Box, margin = CUTOUT_MARGIN): Box {
  return {
    left: rect.left - margin,
    top: rect.top - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

/** The smallest box holding both: a knob and the rings it floats round itself. */
export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

/** True once no part of the box is inside the viewport. */
export function isOffscreen(rect: Box, viewport: Size): boolean {
  return (
    rect.left + rect.width <= 0 ||
    rect.top + rect.height <= 0 ||
    rect.left >= viewport.width ||
    rect.top >= viewport.height
  );
}

/**
 * The mask's path: the whole viewport, with the cut-out as a rounded hole
 * (even-odd fill). No cut-out is a mask with no hole.
 */
export function maskPath(viewport: Size, cutout: Box | null, radius = CUTOUT_RADIUS): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  if (!cutout) return outer;
  const r = Math.max(0, Math.min(radius, cutout.width / 2, cutout.height / 2));
  const { left: x, top: y, width: w, height: h } = cutout;
  const hole = [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join("");
  return `${outer}${hole}`;
}

export type Placement = {
  left: number;
  top: number;
  /** Where the panel sits relative to the cut-out. */
  side: "above" | "below" | "left" | "right" | "docked";
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Where the caption panel goes: on the side of the cut-out with the most room,
 * never over it and never over the bottom bar. With room on no side (a tall
 * cut-out on a phone in portrait) it docks just above the bar.
 */
export function captionPlacement(cutout: Box | null, viewport: Size, panel: Size, bar = BAR_HEIGHT): Placement {
  const floor = viewport.height - bar - PANEL_GAP;
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewport.width - panel.width - VIEWPORT_GUTTER);
  const docked: Placement = {
    left: clamp((viewport.width - panel.width) / 2, VIEWPORT_GUTTER, maxLeft),
    top: Math.max(VIEWPORT_GUTTER, floor - panel.height),
    side: "docked",
  };
  if (!cutout || isOffscreen(cutout, viewport)) return docked;

  const room = {
    above: cutout.top - PANEL_GAP - VIEWPORT_GUTTER,
    below: floor - (cutout.top + cutout.height + PANEL_GAP),
    left: cutout.left - PANEL_GAP - VIEWPORT_GUTTER,
    right: viewport.width - VIEWPORT_GUTTER - (cutout.left + cutout.width + PANEL_GAP),
  };
  const centredX = clamp(cutout.left + cutout.width / 2 - panel.width / 2, VIEWPORT_GUTTER, maxLeft);
  const centredY = clamp(cutout.top + cutout.height / 2 - panel.height / 2, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, floor - panel.height));

  const fits = {
    above: room.above >= panel.height,
    below: room.below >= panel.height,
    left: room.left >= panel.width,
    right: room.right >= panel.width,
  };
  const landscape = viewport.width > viewport.height;
  // Landscape prefers beside, portrait prefers above or below; inside that
  // preference the side with more room wins.
  const order: Array<keyof typeof room> = landscape
    ? (room.right >= room.left ? ["right", "left"] : ["left", "right"]).concat(room.below >= room.above ? ["below", "above"] : ["above", "below"]) as Array<keyof typeof room>
    : (room.below >= room.above ? ["below", "above"] : ["above", "below"]).concat(room.right >= room.left ? ["right", "left"] : ["left", "right"]) as Array<keyof typeof room>;
  const side = order.find((candidate) => fits[candidate]);
  if (!side) return docked;
  switch (side) {
    case "above":
      return { left: centredX, top: cutout.top - PANEL_GAP - panel.height, side };
    case "below":
      return { left: centredX, top: cutout.top + cutout.height + PANEL_GAP, side };
    case "left":
      return { left: cutout.left - PANEL_GAP - panel.width, top: centredY, side };
    case "right":
      return { left: cutout.left + cutout.width + PANEL_GAP, top: centredY, side };
  }
}

/** The caption panel's width: 420px, or the viewport less its gutters. */
export function panelWidth(viewport: Size): number {
  return Math.min(420, Math.max(200, viewport.width - VIEWPORT_GUTTER * 2));
}
