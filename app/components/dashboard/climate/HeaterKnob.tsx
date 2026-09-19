"use client";

import { useMemo } from "react";
import {
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
} from "../../../../lib/bedroom-heater-control";
import type { BedroomHeaterPreferences, DashboardEntity } from "../../../../lib/types";
import { TemperatureEncoder } from "../../TemperatureEncoder";
import type { EncoderLed, RotaryEncoderRing } from "../../RotaryEncoder";
import {
  TIMER_MAX_MINUTES,
  TIMER_STEP_MINUTES,
  TIMER_VALUE_WIDEST,
  clampTargetForDisplay,
  effectiveTargetRange,
  type TargetRange,
  timerValueText,
} from "../../temperatureEncoderModel";
import { useSharedBedroomHeaterCommands } from "../ClimateCommandsProvider";

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
      target={clampTargetForDisplay(heater.displayedTarget, range)}
      title={title}
    />
  );
}
