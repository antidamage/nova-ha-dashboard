/**
 * How a panel arranges the content placed in it.
 *
 * Adeline, 2026-09-25: "the panel will be defined as having (default in the case
 * of maximum room available) either 1x4, 4x1 or 2x2 slot arrangements. these
 * slots will evenly subdivide the space available. inside the slots the content
 * will be centre-top aligned, and will scale up or down to fit in the slot."
 *
 * So a panel is a GRID of equal slots — one per component placed in it — rather
 * than a stack of lines each holding as many controls as fit. The arrangement is
 * the panel's own default while it has room for it: the balanced grid, which is
 * 2x2 for four slots and 3x2 for five. Where the panel has no room for that
 * (a phone, either way up; any panel narrower than the balanced grid needs) the
 * arrangement narrows a column at a time down to a single line along the panel's
 * long axis — one column when the panel is taller than wide, one row when it is
 * wider than tall, which is the "4x1 or 1x4 depending on the screen orientation"
 * a phone gets.
 *
 * The row COUNT follows from the columns, so it is not a free choice: five slots
 * in three columns are two rows, the last one short. A short last row fills from
 * the first column like any other grid.
 *
 * This file is the rule, not the card: the Quick Access card is the first panel
 * to use it (`quick-access/dial-model.ts`), and a panel with one component is the
 * 1x1 case of it — the component fills the panel, centre-top, scaled to it.
 */

/** Columns and rows a panel's slots occupy. */
export type SlotArrangement = {
  columns: number;
  rows: number;
};

/** An arrangement with the width of one slot in it, and the gap between two. */
export type PanelSlotGrid = SlotArrangement & {
  /** The gap between two slots, and between two rows. */
  gap: number;
  /** Every slot's width. The rows divide the panel's height between them. */
  slot: number;
};

/**
 * The gap between two slots, as a share of a slot's own width (Adeline,
 * 2026-09-23: "with some proportional spacing in between"). A slot that has been
 * scaled up to fill its row takes its spacing up with it, so a wide panel reads
 * as generously spaced rather than as a wide panel with pinched gaps; the floor
 * keeps a phone's slots apart, the ceiling stops a very wide panel's gap from
 * eating the slot it belongs to.
 */
export const PANEL_SLOT_GAP_RATIO = 0.05;
export const PANEL_SLOT_GAP_MIN = 8;
export const PANEL_SLOT_GAP_MAX = 28;

/**
 * The columns a panel of `count` slots uses where it has room for them.
 *
 * Two or three things are a single line along the panel's long axis — Adeline,
 * 2026-09-25: "if there are two components, follow the same rules for a 1x2 or
 * 2x1 area depending on layout orientation. continue this pattern." Four or more
 * get the balanced grid, so four are 2x2, five and six 3x2, seven to nine 3x3.
 */
export function balancedColumns(count: number, portrait: boolean): number {
  if (count <= 1) {
    return 1;
  }
  if (count <= 3) {
    return portrait ? 1 : count;
  }
  return Math.ceil(Math.sqrt(count));
}

/** The width of one slot when `columns` of them share a width, with `gap` between. */
export function slotWidth(columns: number, width: number, gap: number): number {
  // Rounded DOWN, so a whole row of slots can never add up to a hundredth of a
  // pixel more than the panel gave it and wrap its last slot onto a row of its
  // own.
  return Math.floor(((width - (columns - 1) * gap) / columns) * 100) / 100;
}

/** The proportional gap for a slot of this width, within the floor and the ceiling. */
export function slotGap(slot: number): number {
  return Math.min(PANEL_SLOT_GAP_MAX, Math.max(PANEL_SLOT_GAP_MIN, Math.round(slot * PANEL_SLOT_GAP_RATIO)));
}

export type PanelSlotRequest = {
  /** How many components the panel holds. */
  count: number;
  /** The panel's own content width, from its measurement. */
  width: number;
  /** The narrowest a slot may be before the content in it cannot work. */
  minWidth: number;
  /** Whether the panel is taller than it is wide. */
  portrait: boolean;
};

/**
 * The grid a panel of `count` components lays them out in.
 *
 * The balanced arrangement is taken first, and then given up a column at a time
 * while a slot would come out narrower than the panel's own minimum — which is
 * the whole of what decides the phone case: two ring-bearing knobs do not fit a
 * phone's width side by side, so the card there is one column, and a wide short
 * panel falls to a single row rather than a row it cannot fill.
 *
 * The height is deliberately NOT consulted. A panel whose rows are shorter than
 * its content scales the content down to them (that is the point of the grid),
 * and one that cannot scale down far enough — too many components, a phone in
 * landscape — scrolls, because "it will be up to the user to ensure they don't
 * over-pack it" (Adeline, 2026-09-25).
 */
export function panelSlotGrid(request: PanelSlotRequest): PanelSlotGrid {
  const count = Math.max(0, Math.floor(request.count));
  if (count === 0) {
    return { columns: 0, gap: PANEL_SLOT_GAP_MIN, rows: 0, slot: 0 };
  }
  let columns = Math.min(count, Math.max(1, balancedColumns(count, request.portrait)));
  if (!(request.width > 0)) {
    // Unmeasured. One column, so the first painted frame lays the slots out
    // rather than collapsing them, and the measurement replaces it a frame later.
    return { columns: 1, gap: PANEL_SLOT_GAP_MIN, rows: count, slot: 0 };
  }
  let gap = PANEL_SLOT_GAP_MIN;
  let slot = slotWidth(columns, request.width, gap);
  // The gap is a share of the slot and the slot is what is left after the gaps,
  // so the two are resolved against each other; three passes settle a
  // proportional gap to the pixel.
  const resolve = () => {
    for (let pass = 0; pass < 3; pass += 1) {
      gap = slotGap(slot);
      slot = slotWidth(columns, request.width, gap);
    }
  };
  resolve();
  while (columns > 1 && slot < request.minWidth) {
    columns -= 1;
    gap = PANEL_SLOT_GAP_MIN;
    slot = slotWidth(columns, request.width, gap);
    resolve();
  }
  return { columns, gap, rows: Math.ceil(count / columns), slot };
}
