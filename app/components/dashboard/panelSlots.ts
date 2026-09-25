/**
 * How a panel arranges the content placed in it.
 *
 * Adeline, 2026-09-25: "the panel will be defined as having (default in the case
 * of maximum room available) either 1x4, 4x1 or 2x2 slot arrangements. these
 * slots will evenly subdivide the space available. inside the slots the content
 * will be centre-top aligned, and will scale up or down to fit in the slot."
 *
 * Adeline, 2026-09-25, on the Quick Access card, which is the panel this rule was
 * first written for: the DIAL slots come first and they are the only thing the
 * grid is for — "the first four slots (strictly for dial controls) should be in a
 * 2x2 grid if there's room, or a 1x4 grid if there isn't". Everything else placed
 * on the card "make[s] a wide slot at the bottom", a single line of the panel's
 * whole width, and that line "collapses" when there is nothing in it.
 *
 * So a panel that groups its slots (`wideBottom`) has two regions: the dial grid -
 * 2x2 for four dials, a single line along the panel's long axis where two columns
 * do not fit, and a column per dial on a phone - and the wide line slots under it,
 * one per module that is not a dial.
 *
 * The row COUNT follows from the columns, so it is not a free choice: five dials
 * in three columns are two rows, the last one short. A short last row fills from
 * the first column like any other grid.
 *
 * This file is the rule, not the card: the Quick Access card is the panel that
 * groups its slots (`quick-access/dial-model.ts`), and a panel with one component
 * is the 1x1 case of it — the component fills the panel, centre-top, scaled to it.
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
  /** Every grid slot's width. The rows divide the panel's height between them. */
  slot: number;
  /**
   * The wide line slots under the grid: one per module that is not a dial, each
   * spanning the panel's whole width and one line tall. 0 when nothing is placed
   * on that row, and 0 on a panel that does not group its slots — the line
   * collapses, and the rows above it take its height.
   */
  wide: number;
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
 * get the balanced grid, so four are 2x2 — the arrangement Adeline named for the
 * card's dials — five and six 3x2, seven to nine 3x3.
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
  /**
   * How many of them are DIAL controls — the ones the grid is for where the panel
   * groups its slots. A panel that does not group passes `count`.
   */
  dials: number;
  /** The narrowest a slot may be before the content in it cannot work. */
  minWidth: number;
  /** Whether the panel is taller than it is wide. */
  portrait: boolean;
  /**
   * Whether the panel lays its dials out in the grid and every other module along
   * a wide line slot under it (the Quick Access card), rather than laying every
   * slot out in the one grid.
   */
  wideBottom: boolean;
  /** The panel's own content width, from its measurement. */
  width: number;
};

/**
 * The grid a panel of `count` components lays them out in, with the wide line
 * slots it needs underneath.
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
    return { columns: 0, gap: PANEL_SLOT_GAP_MIN, rows: 0, slot: 0, wide: 0 };
  }
  // The slots the grid itself places, and the ones that take a wide line under
  // it. A panel that does not group its slots puts all of them in the grid, so
  // these are `count` and 0 and the arrangement is the one it always was.
  const dials = Math.min(count, Math.max(0, Math.floor(request.dials)));
  const spread = request.wideBottom ? dials : count;
  const wide = request.wideBottom ? count - dials : 0;
  // A panel whose modules are ALL on the wide row still needs the one track that
  // row's width is measured against.
  const gridCount = Math.max(1, spread);
  if (!(request.width > 0)) {
    // Unmeasured. One column, so the first painted frame lays the slots out
    // rather than collapsing them, and the measurement replaces it a frame later.
    return { columns: 1, gap: PANEL_SLOT_GAP_MIN, rows: spread, slot: 0, wide };
  }
  let columns = Math.max(1, Math.min(gridCount, balancedColumns(gridCount, request.portrait)));
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
  return { columns, gap, rows: Math.ceil(spread / columns), slot, wide };
}
