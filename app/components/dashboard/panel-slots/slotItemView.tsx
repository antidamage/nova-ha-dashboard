"use client";

import { Fragment, type ReactNode } from "react";
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
    return <Fragment key={item.key}>{content}</Fragment>;
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
