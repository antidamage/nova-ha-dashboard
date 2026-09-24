"use client";

import type { CSSProperties } from "react";
import { dialPresetPull, ringGeometry } from "../../rotaryEncoderGeometry";
import type { QuickSlotLayout } from "../quick-access/dial-model";

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
export function slotGridStyle(layout: QuickSlotLayout, scale = 1): CSSProperties {
  return {
    // One factor for every slot on the panel, so its dials stay the size of each
    // other (Adeline, 2026-09-25: "ideally they'd all scale the same amount").
    "--slot-scale": `${scale}`,
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
