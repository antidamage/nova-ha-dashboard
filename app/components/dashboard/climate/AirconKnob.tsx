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
  type AirconFanStep,
  type AirconMode,
} from "../../../../lib/aircon-control";
import { airconDrySupport } from "../../../../lib/aircon-dry";
import type {
  AirconPreferences,
  ClimateControlRoomState,
  DashboardEntity,
} from "../../../../lib/types";
import { TemperatureEncoder } from "../../TemperatureEncoder";
import type { EncoderLed, RotaryEncoderRing } from "../../RotaryEncoder";
import {
  FAN_VALUE_WIDEST,
  MODE_COOL_COLOUR,
  TIMER_MAX_MINUTES,
  TIMER_STEP_MINUTES,
  TIMER_VALUE_WIDEST,
  effectiveTargetRange,
  fanStepText,
  type TargetRange,
  timerValueText,
} from "../../temperatureEncoderModel";
import { useSharedAirconCommands } from "../ClimateCommandsProvider";
import type { EntityActionsHandler } from "./types";
import { MODE_STOPS_ALL, MODE_STOPS_NO_DRY, MODE_VALUE_WIDEST, airconRunning, targetRange } from "./aircon-knob-model";
import { useClampTargetIntoRange } from "./useClampTargetIntoRange";

export function AirconKnob({
  climateControl,
  entity,
  freshAirSwitch,
  preferences,
  preferredRange,
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
  preferredRange?: TargetRange;
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

  const range = effectiveTargetRange(targetRange(entity), preferredRange);
  useClampTargetIntoRange(aircon.airconSettings.temperature, range, aircon.entityUnavailable, (next) => void aircon.setTemperature(next));
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
  // Only the rings that apply to the mode the unit is in are on show; the rest
  // fold away with the tuck animation and keep their place in the stack, so the
  // ones that remain never change radius (specs/temperature-encoder.md).
  // Auto sets itself — the only thing left to say is when to stop; Off has
  // nothing to set at all.
  const manual = power === "manual";
  // A unit already in Dry always shows the stop, so the thumb has somewhere to sit.
  const drySupport = airconDrySupport(aircon.supportedModes, climateControl?.dryEmulatable === true);
  const MODE_STOPS = activeMode === "dry" || drySupport === "native" || drySupport === "emulated"
    ? MODE_STOPS_ALL
    : MODE_STOPS_NO_DRY;
  const modeIndex = Math.max(0, MODE_STOPS.findIndex((stop) => stop.mode === activeMode));
  const modeColour = off ? null : MODE_STOPS[modeIndex]?.colour ?? null;
  const fanIndex = Math.max(0, AIRCON_FAN_STEPS.indexOf(aircon.fanStep));

  const rings: RotaryEncoderRing[] = [
    {
      id: "mode",
      label: "Mode",
      kind: "selector",
      // Not symmetric: a symmetric ring carries no value, and round 2 puts
      // COOL/DRY/FAN/HEAT at its end (specs/temperature-encoder.md).
      value: modeIndex,
      min: 0,
      max: MODE_STOPS.length - 1,
      step: 1,
      fill: modeColour,
      valueText: (value) => MODE_STOPS[Math.round(value)]?.text ?? "",
      valueTextWidest: MODE_VALUE_WIDEST,
      hidden: !manual,
      disabled: aircon.entityUnavailable,
      onChange: () => undefined,
      onCommit: (value) => {
        const stop = MODE_STOPS[Math.round(value)];
        if (!stop) return;
        if (stop.mode !== "dry" && !airconModeSupported(aircon.supportedModes, stop.mode)) return;
        void aircon.setMode(stop.mode, stop.label);
      },
    },
    {
      id: "fan",
      label: "Fan",
      value: fanIndex,
      min: 0,
      max: AIRCON_FAN_STEPS.length - 1,
      step: 1,
      valueText: (value) => fanStepText(AIRCON_FAN_STEPS[Math.round(value)] ?? "medium"),
      valueTextWidest: FAN_VALUE_WIDEST,
      hidden: !manual,
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
        hidden: !manual,
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
      valueText: (value) => timerValueText(Math.round(value)),
      valueTextWidest: TIMER_VALUE_WIDEST,
      hidden: off,
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
      title={title}
    />
  );
}

