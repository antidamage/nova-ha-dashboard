"use client";

import type { CSSProperties } from "react";
import { dialPresetPull, ringGeometry } from "../../rotaryEncoderGeometry";
import type { QuickSlotLayout } from "../quick-access/slot-layout";

/**
 * The style a panel's slot grid is laid out by, from its measured layout
 * (specs/quick-access-card.md, "The layout slots").
 *
 * One place, because the variables are the mechanism's rather than the card's:
 * every panel that holds slots is drawn by the same stylesheet rule
 * (`app/styles/dashboard/panel-slots.css`), so the card and a panel's slots can
 * never drift into two different grids.
 *
 * They carry plain names now (`--slot-*`, `--dial-*`) rather than the card's:
 * they arrived with Quick Access and drive every panel since 2026-09-25.
 */
export function slotGridStyle(
  layout: QuickSlotLayout,
  scale = 1,
  /**
   * `fits` is the panel's own answer to whether its rows are shares it can scale
   * into or rows it scrolls at (useSlotScale), and `wideScale` the factor the
   * wide line slots use — theirs rather than the dials', because one line of
   * readings must not shrink every dial on the card.
   */
  options: { fits?: boolean; wideScale?: number } = {},
): CSSProperties {
  const { fits = true, wideScale = 1 } = options;
  // A card with wide line slots states its own rows: its dials divide the height
  // that is left once each line under them has taken its one line, so those rows
  // are shares and the lines are not. A panel with no wide slots states nothing
  // and the stylesheet's `grid-auto-rows` sizes every row, as it always has.
  const rows = layout.wide > 0
    ? [
        ...Array.from({ length: layout.rows }, () =>
          layout.rowHeight > 0 ? (fits ? "minmax(0, 1fr)" : "minmax(min-content, 1fr)") : "auto",
        ),
        ...Array.from({ length: layout.wide }, () => `${layout.lineHeight}px`),
      ].join(" ")
    : null;
  return {
    // One factor for every slot on the panel, so its dials stay the size of each
    // other (Adeline, 2026-09-25: "ideally they'd all scale the same amount").
    "--slot-scale": `${scale}`,
    "--wide-scale": `${wideScale}`,
    ...(rows ? { gridTemplateRows: rows } : {}),
    // Left UNSET until the panel has measured itself. Writing a measured 0 would
    // make the stylesheet's `var(--slot-width, 0px)` fallback unreachable and lay
    // every slot out at zero width for the first painted frame, with the dials
    // and their preset rows stacked on the row's centre (found in review).
    // Unset, a slot sizes to its own content until the measurement lands a frame
    // later.
    ...(layout.slot > 0 ? { "--slot-width": `${layout.slot.toFixed(2)}px` } : {}),
    // How many columns the grid has. Written even before the first measurement
    // (it is 1 then), so the stylesheet never has to guess.
    "--slot-columns": `${Math.max(1, layout.columns)}`,
    "--slot-gap": `${layout.gap}px`,
    "--dial-box": `${ringGeometry(layout.size, 0, true).titleFootprint.toFixed(2)}px`,
    // The air under a titled dial's box: its preset row takes it back, so a
    // dial's buttons sit just under it rather than a whole knob-slack away
    // (specs/dial-preset-band.md).
    "--dial-pull": `${dialPresetPull(layout.size).toFixed(2)}px`,
  } as CSSProperties;
}
