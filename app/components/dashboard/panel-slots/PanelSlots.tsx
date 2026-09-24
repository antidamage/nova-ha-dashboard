"use client";

import { useRef, type ReactNode } from "react";
import { PANEL_SURFACES } from "../../../../lib/control-modules/panel-surfaces";
import type { ControlSlotSurface } from "../../../../lib/control-modules/types";
import { classNames } from "../shared";
import { renderSlotItem } from "./slotItemView";
import { slotGridStyle } from "./slotGrid";
import { slotCounts, useSlotLayout } from "./useSlotLayout";
import { useSlotScale } from "./useSlotScale";
import { useSlotItems } from "./useSlotItems";
import { useSlotView } from "./slotViewContext";

/**
 * A panel's slots (specs/control-modules.md, "Slots and the Quick Access row").
 *
 * Adeline, 2026-09-25: "every panel that isn't an existing modular control can
 * default to a single modular slot, with the current content as a module inside
 * of it, so no visible change, but still have the ability to reassign the
 * content."
 *
 * So a panel wraps its own body in this and passes it as the children: the
 * derived configuration places one `panel-content` module in the panel's slot, so
 * the body is drawn exactly where it was and nothing looks different — while the
 * slot is a slot like any other, listed in the Devices tab, where the content can
 * be reassigned, moved, or taken off the panel without losing it.
 *
 * **A panel whose only slot is its own content renders its children directly.**
 * No wrapper, no grid, not one node of difference from the markup the panel had
 * before slots existed — which is what "no visible change" has to mean for a
 * stylesheet full of child selectors. The grid appears the moment something else
 * is placed — a second module, or a control instead of the content — and then it
 * is the same grid the card uses (2x2 for four, one line where the panel has no
 * room for two columns).
 *
 * The panel keeps its own element and classes either way: the grid renders INSIDE
 * it, so the selectors that find the panel (`.zones-panel + .tasks-stage`,
 * `.dashboard-layout > *`) still find it.
 */
export function PanelSlots({
  children,
  className,
  dividesHeight = false,
  roomId,
  surface,
}: {
  /** The panel's current content: what a `panel-content` slot draws. */
  children: ReactNode;
  /** For a panel whose slot grid is a flex or grid child of its own body. */
  className?: string;
  /**
   * Whether this host's grid has a height of its own to divide (the wrappers the
   * stage or the overview gives one), so its modules scale into their rows rather
   * than a row being content-sized.
   */
  dividesHeight?: boolean;
  /**
   * The room this panel's slots inherit. A panel that IS a room's own controls
   * passes that room (a zone's panel); the rest inherit the Home zone, exactly as
   * the card does.
   */
  roomId?: string | null;
  surface: ControlSlotSurface;
}) {
  const view = useSlotView();
  const { items, ready } = useSlotItems(surface, view?.data ?? null, view?.climateZone, roomId);
  const rowRef = useRef<HTMLDivElement>(null);
  // The hooks run in both shapes; a panel holding only its own content has no
  // arrangement to measure and no grid to draw. Every host here is single-column —
  // the card is the one host that lays several out across — so a host's rows are
  // its modules, one each.
  const layout = useSlotLayout(rowRef, slotCounts(items), dividesHeight);
  // `rows: items.length`, NOT the arrangement's rows: these variants draw one
  // track, so the stylesheet gives every module its own row whatever
  // --slot-columns says. Feeding the height term the arrangement's row count made
  // it read the whole wrapper's height as one row's, so a squeeze could not be
  // seen and neither the scale nor the scroll fallback engaged (fifth-round
  // review).
  const { fits, scale } = useSlotScale(rowRef, { dividesHeight, gap: layout.gap, rows: Math.max(1, items.length) });
  // No view (the Plain design), a configuration that has not arrived yet, or
  // nothing placed but the panel's OWN content: the panel draws its own body and
  // not one node changes. A configuration that HAS arrived and places nothing is
  // a different answer — the owner took the content off — and the grid draws
  // nothing for it. The comparison is by preset id, not by kind: another panel's
  // content placed here is not this panel's content (found in review).
  const ownPresetId = PANEL_SURFACES.find((panel) => panel.surface === surface)?.presetId;
  const contentOnly = items.length > 0
    && items.every((item) => item.kind === "panel" && item.presetId === ownPresetId);
  if (!view || !ready || contentOnly) {
    return <>{children}</>;
  }
  return (
    <div
      ref={rowRef}
      className={classNames("panel-slots", className)}
      data-slot-fit={fits ? "scale" : "scroll"}
      style={slotGridStyle(layout, scale)}
    >
      {items.map((item) => renderSlotItem(item, { ...view, content: children, dialSize: layout.size }))}
    </div>
  );
}
