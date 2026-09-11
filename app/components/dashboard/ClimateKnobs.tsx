"use client";

/**
 * The climate knobs: `TemperatureEncoder` wired to the shared command hooks
 * (specs/temperature-encoder.md).
 *
 * Both the full climate cards and the Quick Access segments mount these, so the
 * knob's bindings — which ring does what, what a mode light means, and what
 * happens in Off — exist once. The commands themselves stay in
 * `climateCommands.ts`; nothing here talks to Home Assistant directly.
 */
import { useMemo } from "react";
import {
  AIRCON_FAN_STEPS,
  airconAutoMeasuredTemperature,
  airconAutoSupported,
  airconModeSupported,
  isClimateEntityOn,
  type AirconFanStep,
  type AirconMode,
} from "../../../lib/aircon-control";
import {
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
} from "../../../lib/bedroom-heater-control";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  ClimateControlRoomState,
  DashboardEntity,
} from "../../../lib/types";
import { TemperatureEncoder } from "../TemperatureEncoder";
import type { EncoderLed, RotaryEncoderRing } from "../RotaryEncoder";
import {
  FAN_VALUE_WIDEST,
  MODE_COOL_COLOUR,
  MODE_FAN_COLOUR,
  MODE_HEAT_COLOUR,
  TIMER_MAX_MINUTES,
  TIMER_STEP_MINUTES,
  TIMER_VALUE_WIDEST,
  fanStepText,
  timerValueText,
} from "../temperatureEncoderModel";
import { useSharedAirconCommands, useSharedBedroomHeaterCommands } from "./ClimateCommandsProvider";
import type { EntityActionsHandler } from "./climateCommands";

/** Cool at the 7:30 end, Fan at 12, Heat at the 4:30 end (Adeline, 2026-09-12). */
const MODE_STOPS: ReadonlyArray<{ mode: AirconMode; colour: string }> = [
  { mode: "cool", colour: MODE_COOL_COLOUR },
  { mode: "fan_only", colour: MODE_FAN_COLOUR },
  { mode: "heat", colour: MODE_HEAT_COLOUR },
] as const;

/** What the aircon's entity says about its range, or the usual 16–30. */
function targetRange(entity?: DashboardEntity) {
  const min = Number(entity?.attributes?.min_temp);
  const max = Number(entity?.attributes?.max_temp);
  return {
    min: Number.isFinite(min) ? min : 16,
    max: Number.isFinite(max) ? max : 30,
  };
}

/** Running means the ring glows: heating, cooling or moving air right now. */
function airconRunning(entity: DashboardEntity | undefined, powerOff: boolean) {
  if (!entity || powerOff) return false;
  return ["heat", "cool", "fan_only", "dry"].includes(entity.state) && isClimateEntityOn(entity);
}

export function AirconKnob({
  climateControl,
  entity,
  freshAirSwitch,
  preferences,
  quietSwitch,
  size = 200,
  title,
  turboSwitch,
  onEntityActions,
}: {
  climateControl?: ClimateControlRoomState;
  entity: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  size?: number;
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  const aircon = useSharedAirconCommands({
    controlState: climateControl,
    entity,
    freshAirSwitch,
    preferences,
    quietSwitch,
    turboSwitch,
    onEntityActions,
  });

  const range = targetRange(entity);
  const power = aircon.displayedPowerState;
  const off = power === "off";

  const modes: EncoderLed[] = useMemo(
    () => [
      { id: "auto", label: "Auto", skip: !airconAutoSupported(aircon.supportedModes) },
      { id: "manual", label: "Manual" },
      { id: "off", label: "Off" },
    ],
    [aircon.supportedModes],
  );

  // In Off the thumb sits on the remembered mode and the track stays an empty
  // well, because nothing is running (Adeline, 2026-09-12).
  const activeMode = aircon.activeMode ?? (aircon.airconSettings.hvacMode as AirconMode | undefined);
  const modeIndex = Math.max(0, MODE_STOPS.findIndex((stop) => stop.mode === activeMode));
  const modeColour = off ? null : MODE_STOPS[modeIndex]?.colour ?? null;
  const fanIndex = Math.max(0, AIRCON_FAN_STEPS.indexOf(aircon.fanStep));

  const rings: RotaryEncoderRing[] = [
    {
      id: "mode",
      label: "Mode",
      kind: "selector",
      symmetric: true,
      value: modeIndex,
      min: 0,
      max: MODE_STOPS.length - 1,
      step: 1,
      fill: modeColour,
      disabled: aircon.entityUnavailable,
      onChange: () => undefined,
      onCommit: (value) => {
        const stop = MODE_STOPS[Math.round(value)];
        if (!stop || !airconModeSupported(aircon.supportedModes, stop.mode)) return;
        void aircon.setMode(stop.mode, stop.mode === "fan_only" ? "Fan" : stop.mode === "cool" ? "Cooling" : "Heating");
      },
    },
    {
      id: "fan",
      label: "Fan",
      value: fanIndex,
      min: 0,
      max: AIRCON_FAN_STEPS.length - 1,
      step: 1,
      valueText: fanStepText(AIRCON_FAN_STEPS[fanIndex] ?? "medium"),
      valueTextWidest: FAN_VALUE_WIDEST,
      disabled: aircon.entityUnavailable,
      onChange: () => undefined,
      onCommit: (value) => {
        void aircon.setFanStep((AIRCON_FAN_STEPS[Math.round(value)] ?? "medium") as AirconFanStep);
      },
    },
    ...(freshAirSwitch
      ? [{
        id: "fresh",
        label: "Fresh Air",
        kind: "toggle" as const,
        value: aircon.freshAirOn ? 1 : 0,
        min: 0,
        max: 1,
        fill: MODE_COOL_COLOUR,
        disabled: aircon.entityUnavailable,
        onChange: () => undefined,
        onCommit: () => {
          void aircon.toggleFreshAir();
        },
      }]
      : []),
    {
      id: "timer",
      label: "Timer",
      value: Math.min(TIMER_MAX_MINUTES, aircon.offTimerMinutes),
      min: 0,
      max: TIMER_MAX_MINUTES,
      step: TIMER_STEP_MINUTES,
      valueText: timerValueText(aircon.offTimerMinutes),
      valueTextWidest: TIMER_VALUE_WIDEST,
      disabled: aircon.entityUnavailable,
      onChange: () => undefined,
      onCommit: (value) => {
        void aircon.setOffTimerMinutes(Math.round(value));
      },
    },
  ];

  return (
    <TemperatureEncoder
      ariaLabel={`${title} air conditioner`}
      disabled={aircon.entityUnavailable}
      maxTarget={range.max}
      minTarget={range.min}
      mode={power}
      modes={modes}
      onModeChange={(next) => aircon.choosePowerStateAfterTaps(next as "auto" | "manual" | "off")}
      onTargetChange={(next) => void aircon.setTemperature(next)}
      room={airconAutoMeasuredTemperature(entity)}
      running={airconRunning(entity, off)}
      rings={rings}
      size={size}
      target={aircon.airconSettings.temperature ?? null}
    />
  );
}

export function HeaterKnob({
  humidity,
  preferences,
  size = 200,
  switchEntity,
  temperature,
  title,
  onNotice,
}: {
  humidity?: number | null;
  preferences?: BedroomHeaterPreferences;
  size?: number;
  switchEntity: DashboardEntity;
  temperature: number | null;
  title: string;
  onNotice?: (message: string) => void;
}) {
  const heater = useSharedBedroomHeaterCommands({ onNotice, preferences });
  const unavailable = ["unavailable", "unknown"].includes(switchEntity.state);

  // Two lights, not three: the heater has no Manual, which did the same thing
  // as Auto in a cold room and was retired in August 2026 (Adeline).
  const modes: EncoderLed[] = useMemo(
    () => [
      { id: "auto", label: "Auto" },
      { id: "off", label: "Off" },
    ],
    [],
  );

  const rings: RotaryEncoderRing[] = [
    {
      id: "timer",
      label: "Timer",
      value: Math.min(TIMER_MAX_MINUTES, heater.offTimerMinutes),
      min: 0,
      max: TIMER_MAX_MINUTES,
      step: TIMER_STEP_MINUTES,
      valueText: timerValueText(heater.offTimerMinutes),
      valueTextWidest: TIMER_VALUE_WIDEST,
      disabled: unavailable,
      onChange: () => undefined,
      onCommit: (value) => {
        void heater.setOffTimerMinutes(Math.round(value));
      },
    },
  ];

  return (
    <TemperatureEncoder
      ariaLabel={`${title} heater${typeof humidity === "number" ? `, humidity ${Math.round(humidity)} percent` : ""}`}
      disabled={unavailable}
      maxTarget={BEDROOM_HEATER_MAX_TARGET_C}
      minTarget={BEDROOM_HEATER_MIN_TARGET_C}
      mode={heater.displayedMode}
      modes={modes}
      onModeChange={(next) => heater.chooseModeAfterTaps(next as "auto" | "off")}
      onTargetChange={(next) => void heater.changeTarget(next)}
      room={temperature}
      running={switchEntity.state === "on"}
      rings={rings}
      size={size}
      target={heater.displayedTarget ?? null}
    />
  );
}
