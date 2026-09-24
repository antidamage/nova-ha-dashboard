"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import { dialPresetPull, ringGeometry } from "../../rotaryEncoderGeometry";
import type { EntityActionsHandler } from "../climateCommands";
import { QuickAppleTVSegment } from "./QuickAppleTVSegment";
import type { QuickItem } from "./quickSlotModel";
import { QuickAirconSegment, QuickHeaterSegment } from "./QuickClimateSegments";
import { QuickLightsSegment } from "./QuickLightsSegment";
import { QuickWeatherSegment } from "./QuickWeatherSegment";
import { useQuickSlotLayout } from "./useQuickSlotLayout";

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
 * dial on the card is drawn at come from `useQuickSlotLayout`, which measures the
 * card's own box; the stylesheet only says how a slot's content sits in it
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
  const layout = useQuickSlotLayout(rowRef, {
    count: items.length,
    dials: items.filter((item) => item.kind !== "outside").length,
    readings: items.filter((item) => item.kind === "outside").length,
  });
  const { size: dialSize } = layout;
  // Consumed by the stylesheet; see app/styles/dashboard/quick-access-dials.css.
  const rowStyle = {
    // Left UNSET until the card has measured itself. Writing a measured 0 would
    // make the stylesheet's `var(--quick-slot, 0px)` fallback unreachable and lay
    // every slot out at zero width for the first painted frame, with the dials
    // and their preset rows stacked on the row's centre (found in review).
    // Unset, a slot sizes to its own content until the measurement lands a frame
    // later.
    ...(layout.slot > 0 ? { "--quick-slot": `${layout.slot.toFixed(2)}px` } : {}),
    // How many columns the grid has. Written even before the first measurement
    // (it is 1 then), so the stylesheet never has to guess.
    "--quick-columns": `${Math.max(1, layout.columns)}`,
    "--quick-slot-gap": `${layout.gap}px`,
    "--quick-dial-box": `${ringGeometry(dialSize, 0, true).titleFootprint.toFixed(2)}px`,
    // The air under a titled dial's box: its preset row takes it back, so a
    // dial's buttons sit just under it rather than a whole knob-slack away
    // (specs/dial-preset-band.md).
    "--quick-dial-pull": `${dialPresetPull(dialSize).toFixed(2)}px`,
  } as CSSProperties;

  const render = (item: QuickItem): ReactNode => {
    if (item.kind === "lighting") {
      return (
        <QuickLightsSegment
          key={item.key}
          knobSkin={knobSkin}
          item={item}
          size={dialSize}
          sun={sun}
          onZoneAction={(action, body) => onZoneAction(item.zone, action, body)}
        />
      );
    }
    if (item.kind === "amplifier") {
      return <QuickAppleTVSegment key={item.key} knobSkin={knobSkin} size={dialSize} />;
    }
    if (item.kind === "climate") {
      return item.variant === "heater" ? (
        <QuickHeaterSegment item={item} key={item.key} size={dialSize} onNotice={onNotice} />
      ) : (
        <QuickAirconSegment item={item} key={item.key} size={dialSize} onEntityActions={onEntityActions} />
      );
    }
    return <QuickWeatherSegment key={item.key} features={item.features} weather={weather} />;
  };

  return (
    <section className="quick-access" aria-label="Quick Access" data-card-id="quick-access">
      <div ref={rowRef} className="quick-access-row" style={rowStyle}>
        {items.map(render)}
      </div>
    </section>
  );
}
