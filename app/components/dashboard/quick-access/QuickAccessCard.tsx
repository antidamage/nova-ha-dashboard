"use client";

import { useRef } from "react";
import type { DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import type { EntityActionsHandler } from "../climateCommands";
import { renderSlotItem } from "../panel-slots/slotItemView";
import { slotGridStyle } from "../panel-slots/slotGrid";
import { slotCounts, useSlotLayout } from "../panel-slots/useSlotLayout";
import { useSlotScale } from "../panel-slots/useSlotScale";
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
 * Layout is one GRID of equal slots, one slot per module placed on the card, in
 * the order the slots are configured in (Adeline, 2026-09-25). The arrangement —
 * 2x2 for four slots, 3x2 for five, one line down a phone — and the size every
 * dial on the card is drawn at come from the shared slot layout, which measures
 * the card's own box. The card is the first of the panels that hold slots, so
 * what is here is its chrome: the grid, the renderer per item and the dial
 * geometry are `app/components/dashboard/panel-slots/`
 * (specs/quick-access-card.md).
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
  // The card divides a height of its own: it is a column of the page's fixed
  // column height in landscape, and its rows split that between them
  // (app/styles/responsive/landscape.css).
  const layout = useSlotLayout(rowRef, slotCounts(items), true);
  const { fits, scale } = useSlotScale(rowRef, { dividesHeight: true, gap: layout.gap, rows: layout.rows });
  return (
    <section className="quick-access" aria-label="Quick Access" data-card-id="quick-access">
      <div
        ref={rowRef}
        className="panel-slots panel-slots-divides-height quick-access-row"
        data-slot-fit={fits ? "scale" : "scroll"}
        style={slotGridStyle(layout, scale)}
      >
        {items.map((item) =>
          renderSlotItem(item, { dialSize: layout.size, knobSkin, onEntityActions, onNotice, onZoneAction, sun, weather }),
        )}
      </div>
    </section>
  );
}
