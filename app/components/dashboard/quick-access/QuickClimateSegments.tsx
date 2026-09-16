"use client";

import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  ClimateControlState,
  DashboardEntity,
} from "../../../../lib/types";
import { AirconKnob, HeaterKnob } from "../ClimateKnobs";
import type { EntityActionsHandler } from "../climateCommands";
import type { BedroomHeaterDevices } from "../shared";
import { QUICK_TEMPERATURE_SIZE } from "./dial-model";
import { QuickClimate } from "./QuickSegment";

/**
 * The climate segments' stepper, current-temperature readout and Auto/Off pair
 * are gone: the temperature knob carries all three (Adeline, 2026-09-12,
 * specs/temperature-encoder.md).
 */

/**
 * The lounge air conditioner: the room's name and a 100px temperature knob
 * (Adeline, 2026-09-12). The stepper, the state word and the Auto/Off buttons
 * are all on the knob now — see specs/temperature-encoder.md. Its rings float
 * over the page, so the tile is only as tall as the knob.
 */
export function QuickAirconSegment({
  climateControl,
  entity,
  freshAirSwitch,
  preferences,
  preferredRange,
  quietSwitch,
  size = QUICK_TEMPERATURE_SIZE,
  title,
  turboSwitch,
  onEntityActions,
}: {
  climateControl?: ClimateControlState;
  entity: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  preferredRange?: { min: number; max: number };
  quietSwitch?: DashboardEntity;
  /** Knob diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  return (
    <QuickClimate label={`${title} air conditioner`}>
      <AirconKnob
        climateControl={climateControl?.lounge}
        entity={entity}
        freshAirSwitch={freshAirSwitch}
        preferences={preferences}
        preferredRange={preferredRange}
        quietSwitch={quietSwitch}
        size={size}
        title={title}
        turboSwitch={turboSwitch}
        onEntityActions={onEntityActions}
      />
    </QuickClimate>
  );
}

/** The bedroom heater: the room's name and a 100px temperature knob. */
export function QuickHeaterSegment({
  devices,
  preferences,
  preferredRange,
  size = QUICK_TEMPERATURE_SIZE,
  title,
  onNotice,
}: {
  devices: BedroomHeaterDevices & { switchEntity: DashboardEntity };
  preferences?: BedroomHeaterPreferences;
  preferredRange?: { min: number; max: number };
  /** Knob diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
  title: string;
  onNotice?: (message: string) => void;
}) {
  return (
    <QuickClimate label={`${title} heater`}>
      <HeaterKnob
        humidity={devices.humidity}
        preferences={preferences}
        preferredRange={preferredRange}
        size={size}
        switchEntity={devices.switchEntity}
        temperature={devices.temperature ?? null}
        title={title}
        onNotice={onNotice}
      />
    </QuickClimate>
  );
}
