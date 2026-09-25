"use client";

import { useRef } from "react";
import type { DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import type { EntityActionsHandler } from "../climateCommands";
import { isDialKind, slotCounts, slotItemsInOrder, useSlotLayout } from "../panel-slots/useSlotLayout";
import { useSlotScale } from "../panel-slots/useSlotScale";
import { renderSlotItem, renderWideSlotItem } from "../panel-slots/slotItemView";
import { slotGridStyle } from "../panel-slots/slotGrid";
import type { QuickItem } from "./quickSlotModel";

/**
 * Quick Access: the home card, built from configuration
 * (specs/control-modules.md).
 *
 * The card owns layout and nothing else. Every control it shows arrives as a
 * resolved item carrying the device it drives, the room it serves, its own
 * feature switches and the renderer that draws it, so a preset placed here is
 * drawn by its module's renderer rather than by a branch in this file. The card
 * still takes props only and reads no globals, so another surface can mount it or
 * any one segment.
 *
 * Layout is one grid of equal DIAL slots — the four dial controls sit in a 2x2
 * where the card has room for it, and in a single line down the card where it has
 * not — with every module that is not a dial on a wide line slot under them
 * (Adeline, 2026-09-25: "the first four slots (strictly for dial controls) should
 * be in a 2x2 grid if there's room, or a 1x4 grid if there isn't ... make a wide
 * slot at the bottom for it. if there is no content in it, the line slot
 * collapses"). The arrangement and the size every dial on the card is drawn at
 * come from the shared slot layout, which measures the card's own box; the chrome
 * is the grid, the renderer per item and the dial geometry in
 * `app/components/dashboard/panel-slots/` (specs/quick-access-card.md).
 */

export type QuickAccessCardProps = {
  items: QuickItem[];
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  sun?: SunStatus | null;
  weather?: WeatherStatus | null;
  onEntityActions: EntityActionsHandler;
  /**
   * A zone action from a lighting slot, bound to THAT slot's room. The card
   * passes the zone rather than closing over one: a lighting module placed in
   * any room must act on the room it was placed in.
   */
  onZoneAction: (zone: DashboardZone, action: string, body?: Record<string, unknown>) => Promise<void>;
  onNotice?: (message: string) => void;
};

export function QuickAccessCard({
  items,
  knobSkin,
  sun,
  weather,
  onEntityActions,
  onZoneAction,
  onNotice,
}: QuickAccessCardProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // A module the card cannot draw is not a slot at all. A panel's own content
  // belongs to the panel it came from — another panel's is refused at the picker,
  // and the card hands it nothing — so drawing it would be a hole in the middle of
  // the dials, which is the same reason a slot whose module is gone renders
  // nothing (specs/control-modules.md). Adeline, 2026-09-25: "if there is no
  // content in it, the line slot collapses."
  const placed = items.filter((item) => item.kind !== "panel");
  // The card divides a height of its own — it is a column of the page's fixed
  // column height in landscape — and it groups its slots: the dials take the grid
  // and everything else the wide line under it (app/styles/responsive/landscape.css).
  const layout = useSlotLayout(rowRef, slotCounts(placed), { dividesHeight: true, wideBottom: true });
  const { fits, scale, wideScale } = useSlotScale(rowRef, {
    // The model has already taken the wide lines out of the card's height, so a
    // dial's share is the row it was drawn for.
    available: layout.rowHeight,
    dividesHeight: true,
    gap: layout.gap,
    rows: Math.max(1, layout.rows + layout.wide),
  });
  const view = { dialSize: layout.size, knobSkin, onEntityActions, onNotice, onZoneAction, sun, weather };
  return (
    <section className="quick-access" aria-label="Quick Access" data-card-id="quick-access">
      <div
        ref={rowRef}
        className="panel-slots panel-slots-divides-height quick-access-row"
        data-slot-fit={fits ? "scale" : "scroll"}
        style={slotGridStyle(layout, scale, { fits, wideScale })}
      >
        {slotItemsInOrder(placed, true).map((item) =>
          isDialKind(item.kind) ? renderSlotItem(item, view) : renderWideSlotItem(item, view),
        )}
      </div>
    </section>
  );
}
