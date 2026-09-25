"use client";

import type { ReactNode } from "react";
import { QuickAppleTVSegment } from "../quick-access/QuickAppleTVSegment";
import { QuickAirconSegment, QuickHeaterSegment } from "../quick-access/QuickClimateSegments";
import { QuickLightsSegment } from "../quick-access/QuickLightsSegment";
import { QuickWeatherSegment } from "../quick-access/QuickWeatherSegment";
import type { QuickItem } from "../quick-access/quickSlotModel";
import type { SlotView } from "./slotViewContext";

/** The part of the view a slot's item needs to draw itself. */
export type SlotItemViewProps = Pick<
  SlotView,
  "knobSkin" | "sun" | "weather" | "onEntityActions" | "onZoneAction" | "onNotice"
>;

/**
 * One item, drawn by the renderer its module names
 * (specs/control-modules.md).
 *
 * One place, so a module placed on the Quick Access card and the same module
 * placed on another panel cannot be drawn two different ways — the panel host
 * and the card both come through here. The `panel` item is the one that is not a
 * control: it draws the content its PANEL handed over, which is how every panel's
 * own content is a module that can be reassigned rather than a hard-coded body.
 */
export function renderSlotItem(
  item: QuickItem,
  props: SlotItemViewProps & { content?: ReactNode; dialSize: number },
): ReactNode {
  const { content, dialSize, knobSkin, onEntityActions, onNotice, onZoneAction, sun, weather } = props;
  if (item.kind === "panel") {
    // ONE slot, so the content is wrapped: a fragment's children would each become
    // a grid item and the panel's own body would be laid out across the track.
    return (
      <div className="panel-slot-content" key={item.key}>
        {content}
      </div>
    );
  }
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
}

/**
 * One module in the wide line slot under a panel's dial grid: the same item, in
 * the element that marks the region (Adeline, 2026-09-25: "make a wide slot at
 * the bottom for it"). The slot is one line of the panel's whole width, and the
 * stylesheet lays its content out across that line.
 *
 * Only a module that is NOT a dial is wrapped: a slot holding a dial is the
 * segment itself, exactly as it was before the card had regions, so nothing about
 * a dial's own markup moved.
 */
export function renderWideSlotItem(
  item: QuickItem,
  props: SlotItemViewProps & { content?: ReactNode; dialSize: number },
): ReactNode {
  return (
    <div className="panel-slot-wide" data-slot-region="wide" key={item.key}>
      {renderSlotItem(item, props)}
    </div>
  );
}
