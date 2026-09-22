"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { DashboardZone, SunStatus, WeatherStatus } from "../../../../lib/types";
import { dialPresetPull, ringGeometry } from "../../rotaryEncoderGeometry";
import type { EntityActionsHandler } from "../climateCommands";
import { QuickAppleTVSegment } from "./QuickAppleTVSegment";
import { quickDialSlot } from "./dial-model";
import type { QuickItem } from "./quickSlotModel";
import { QuickAirconSegment, QuickHeaterSegment } from "./QuickClimateSegments";
import { QuickLightsSegment } from "./QuickLightsSegment";
import { QuickWeatherSegment } from "./QuickWeatherSegment";
import { useQuickDialSize } from "./useQuickDialSize";

/**
 * Quick Access: the one-line home card, now built from configuration
 * (specs/control-modules.md).
 *
 * The card owns layout and nothing else. Every control it shows arrives as a
 * resolved item carrying the device it drives, the room it serves, its own
 * feature switches and the row it belongs to, so a preset placed here is drawn
 * by its module's renderer rather than by a branch in this file. The card still
 * takes props only and reads no globals, so another surface can mount it or any
 * one segment.
 *
 * Three rows, because that is what the stylesheet is built on: the first dial
 * line (the room's lights and the amplifier, side by side), the climate knobs,
 * and the readings. A module declares its row; slot order decides position
 * within one. The derived slot order produces exactly the DOM this card had
 * before it was configurable.
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
  const { pair, size: dialSize } = useQuickDialSize(rowRef);
  // Consumed only by the portrait CSS; see globals.css, "Portrait only".
  const rowStyle = {
    "--quick-dial-slot": `${quickDialSlot(dialSize).toFixed(2)}px`,
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

  const inRegion = (region: QuickItem["region"]) => items.filter((item) => item.region === region);
  const dials = inRegion("dial-line");
  const climate = inRegion("climate");
  const readings = inRegion("readings");

  return (
    <section className="quick-access" aria-label="Quick Access" data-card-id="quick-access">
      <div ref={rowRef} className="quick-access-row" data-quick-pair={pair} style={rowStyle}>
        {/* The card's first line: the dials that are not climate, each with its
            own preset row under it. Rendered only when a slot claims it, so a
            card with no lighting or amplifier module keeps its old shape. */}
        {dials.length ? <div className="quick-dial-line">{dials.map(render)}</div> : null}
        {/* Portrait: a zero-height full-width cell, so the climate dials take
            the line below the pair instead of joining it. */}
        <span className="quick-dial-break" aria-hidden="true" />
        {climate.length ? (
          <div className="quick-climate-row">{climate.map(render)}</div>
        ) : null}
        {readings.map(render)}
      </div>
    </section>
  );
}
