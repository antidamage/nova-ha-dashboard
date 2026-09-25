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
 * So a panel wraps its own body in this and passes it as the children, and the
 * body is drawn exactly where it was: it is what the panel shows unless a CONTROL
 * is placed beside it. The panel's own content is a preset like any other, listed
 * in the Devices tab, where it can be reassigned, moved or replaced — and where a
 * control placed beside it puts both on the panel's grid.
 *
 * **A panel showing only its own content renders its children directly.** No
 * wrapper, no grid, not one node of difference from the markup the panel had
 * before slots existed — which is what "no visible change" has to mean for a
 * stylesheet full of child selectors, and what a configuration saved before these
 * surfaces existed gets. The grid appears the moment a CONTROL is placed on the
 * panel, and it is one column wide: a panel's body stacks what is placed on it,
 * growing down, where the card lays several modules out across
 * (`panel-slots-fill`, app/styles/dashboard/panel-slots.css).
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
  // the card is the one host that lays several out across and the only one that
  // groups its slots (a dial grid with a wide line under it) — so a host's rows
  // are its modules, one each.
  const layout = useSlotLayout(rowRef, slotCounts(items), { dividesHeight });
  // `rows: items.length`, NOT the arrangement's rows: these variants draw one
  // track, so the stylesheet gives every module its own row whatever
  // --slot-columns says. Feeding the height term the arrangement's row count made
  // it read the whole wrapper's height as one row's, so a squeeze could not be
  // seen and neither the scale nor the scroll fallback engaged (fifth-round
  // review).
  const { fits, scale } = useSlotScale(rowRef, { dividesHeight, gap: layout.gap, rows: Math.max(1, items.length) });
  // The panel's content is drawn unless a CONTROL has been placed on this
  // surface: the content IS the panel, and the slot grid only appears when there
  // is something else to lay out beside it.
  //
  // This is not a nicety, and getting it wrong broke the live dashboard on
  // 2026-09-25. A configuration that predates the panel surfaces has no slots for
  // them AT ALL — which is every install that has ever opened the Devices tab,
  // because a stored controls block wins outright over the derivation — so the
  // "no items" case is the ordinary one, not the emptied one, and treating it as
  // "nothing is placed here" suppressed the body of every panel on the page.
  // (The e2e could not see it: the demo has no stored configuration.)
  const ownPresetId = PANEL_SURFACES.find((panel) => panel.surface === surface)?.presetId;
  const placedControls = items.filter((item) => item.kind !== "panel");
  if (!view || !ready || placedControls.length === 0) {
    return <>{children}</>;
  }
  return (
    <div
      ref={rowRef}
      className={classNames("panel-slots", className)}
      data-slot-fit={fits ? "scale" : "scroll"}
      style={slotGridStyle(layout, scale, { fits })}
    >
      {items.map((item) =>
        // Only a panel's OWN content preset draws the panel's body: another
        // panel's content placed here draws nothing rather than this panel's.
        renderSlotItem(item, {
          ...view,
          content: item.kind === "panel" && item.presetId === ownPresetId ? children : undefined,
          dialSize: layout.size,
        }))}
    </div>
  );
}
