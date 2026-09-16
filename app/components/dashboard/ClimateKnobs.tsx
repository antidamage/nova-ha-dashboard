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
import { useEffect, useMemo, useRef } from "react";
import {
  AIRCON_FAN_STEPS,
  airconAutoMeasuredTemperature,
  airconAutoSupported,
  airconModeSupported,
  isClimateEntityOn,
  type AirconFanStep,
  type AirconMode,
} from "../../../lib/aircon-control";
import { airconDrySupport } from "../../../lib/aircon-dry";
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
  MODE_DRY_COLOUR,
  MODE_FAN_COLOUR,
  MODE_HEAT_COLOUR,
  TIMER_MAX_MINUTES,
  TIMER_STEP_MINUTES,
  TIMER_VALUE_WIDEST,
  effectiveTargetRange,
  fanStepText,
  type TargetRange,
  timerValueText,
} from "../temperatureEncoderModel";
import { useSharedAirconCommands, useSharedBedroomHeaterCommands } from "./ClimateCommandsProvider";
import type { EntityActionsHandler } from "./climateCommands";

type ModeStop = { mode: AirconMode; colour: string; text: string; label: string };

/**
 * Left to right: Cool, Dry, Fan, Heat. Dry is a stop only when the unit has it
 * or Nova can emulate it; otherwise three stops (specs/temperature-encoder.md,
 * round 2).
 */
const MODE_STOPS_ALL: ReadonlyArray<ModeStop> = [
  { mode: "cool", colour: MODE_COOL_COLOUR, text: "COOL", label: "Cooling" },
  { mode: "dry", colour: MODE_DRY_COLOUR, text: "DRY", label: "Dry" },
  { mode: "fan_only", colour: MODE_FAN_COLOUR, text: "FAN", label: "Fan" },
  { mode: "heat", colour: MODE_HEAT_COLOUR, text: "HEAT", label: "Heating" },
];
const MODE_STOPS_NO_DRY = MODE_STOPS_ALL.filter((stop) => stop.mode !== "dry");
const MODE_VALUE_WIDEST = "HEAT";

/** What the aircon's entity says about its range, or the usual 16–30. */
function targetRange(entity?: DashboardEntity) {
  const min = Number(entity?.attributes?.min_temp);
  const max = Number(entity?.attributes?.max_temp);
  return {
    min: Number.isFinite(min) ? min : 16,
    max: Number.isFinite(max) ? max : 30,
  };
}

/**
 * Clamp and send: a target outside the knob's range is pulled to the nearest
 * edge and sent once for that target and range (specs/temperature-encoder.md).
 */
function useClampTargetIntoRange(
  target: number | null | undefined,
  range: TargetRange,
  disabled: boolean,
  send: (next: number) => void,
) {
  const sentFor = useRef<string | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (disabled || typeof target !== "number" || !Number.isFinite(target)) return;
    const clamped = Math.max(range.min, Math.min(range.max, target));
    if (clamped === target) {
      sentFor.current = null;
      return;
    }
    const key = `::`;
    if (sentFor.current === key) return;
    sentFor.current = key;
    sendRef.current(clamped);
  }, [disabled, range.min, range.max, target]);
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

export function HeaterKnob({
  humidity,
  preferences,
  preferredRange,
  size = 200,
  switchEntity,
  temperature,
  title,
  onNotice,
}: {
  humidity?: number | null;
  preferences?: BedroomHeaterPreferences;
  preferredRange?: TargetRange;
  size?: number;
  switchEntity: DashboardEntity;
  temperature: number | null;
  title: string;
  onNotice?: (message: string) => void;
}) {
  const heater = useSharedBedroomHeaterCommands({ onNotice, preferences });
  const unavailable = ["unavailable", "unknown"].includes(switchEntity.state);
  const range = effectiveTargetRange({ min: BEDROOM_HEATER_MIN_TARGET_C, max: BEDROOM_HEATER_MAX_TARGET_C }, preferredRange);
  useClampTargetIntoRange(heater.displayedTarget, range, unavailable, (next) => void heater.changeTarget(next));

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
      valueText: (value) => timerValueText(Math.round(value)),
      valueTextWidest: TIMER_VALUE_WIDEST,
      // Off has nothing to time (specs/temperature-encoder.md).
      hidden: heater.displayedMode === "off",
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
      maxTarget={range.max}
      minTarget={range.min}
      mode={heater.displayedMode}
      modes={modes}
      onModeChange={(next) => heater.chooseModeAfterTaps(next as "auto" | "off")}
      onTargetChange={(next) => void heater.changeTarget(next)}
      room={temperature}
      running={switchEntity.state === "on"}
      rings={rings}
      size={size}
      target={heater.displayedTarget ?? null}
      title={title}
    />
  );
}
