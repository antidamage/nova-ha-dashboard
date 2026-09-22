"use client";

import type { DashboardEntity } from "../../../../lib/types";
import { AirconKnob, HeaterKnob } from "../ClimateKnobs";
import type { EntityActionsHandler } from "../climateCommands";
import type { QuickAirconItem, QuickHeaterItem } from "./quickSlotModel";
import { QUICK_TEMPERATURE_SIZE } from "./dial-model";
import { QuickClimate } from "./QuickSegment";

/**
 * The climate segments: a resolved Quick Access climate item drawn as the
 * temperature knob its preset asked for.
 *
 * The module decides the SHAPE (a climate knob, an air conditioner or a
 * heater); the driver decides what the knob can reach. Gating the auxiliary
 * switches and the timer ring on the preset's own feature switches is what makes
 * "assign this control to another heating device" mean something — an aircon
 * preset pointed at a unit with no Quiet switch simply has no Quiet ring.
 *
 * The stepper, the state word and the Auto/Off pair are not here: the knob
 * carries all three (specs/temperature-encoder.md).
 */

export function QuickAirconSegment({
  item,
  size = QUICK_TEMPERATURE_SIZE,
  onEntityActions,
}: {
  item: QuickAirconItem;
  /** Knob diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
  onEntityActions: EntityActionsHandler;
}) {
  const auxiliary = item.features["quiet-turbo-fresh-air"] !== false;
  return (
    <QuickClimate label={`${item.title} air conditioner`}>
      <AirconKnob
        climateControl={item.climateControl}
        entity={item.aircon.entity}
        freshAirSwitch={auxiliary ? item.aircon.freshAirSwitch : undefined}
        preferences={item.preferences}
        preferredRange={item.preferredRange}
        quietSwitch={auxiliary ? item.aircon.quietSwitch : undefined}
        showFanRing={item.features["fan-ring"] !== false}
        showTimerRing={item.features["off-timer"] !== false}
        size={size}
        title={item.title}
        turboSwitch={auxiliary ? item.aircon.turboSwitch : undefined}
        onEntityActions={onEntityActions}
      />
    </QuickClimate>
  );
}

export function QuickHeaterSegment({
  item,
  size = QUICK_TEMPERATURE_SIZE,
  onNotice,
}: {
  item: QuickHeaterItem;
  /** Knob diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
  onNotice?: (message: string) => void;
}) {
  const humidity = item.features["humidity-readout"] === false ? null : item.heater.humidity ?? null;
  return (
    <QuickClimate label={`${item.title} heater`}>
      <HeaterKnob
        humidity={humidity}
        preferences={item.preferences}
        preferredRange={item.preferredRange}
        showTimerRing={item.features["off-timer"] !== false}
        size={size}
        switchEntity={item.heater.switchEntity as DashboardEntity}
        temperature={item.heater.temperature}
        title={item.title}
        onNotice={onNotice}
      />
    </QuickClimate>
  );
}
