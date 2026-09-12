"use client";

/**
 * A live temperature knob with no devices behind it, for the demo pages and the
 * visual gauntlet (specs/temperature-encoder.md). Every ring is local state;
 * nothing is sent to Home Assistant.
 */
import { useEffect, useState } from "react";
import { TemperatureEncoder } from "./TemperatureEncoder";
import type { RotaryEncoderRing } from "./RotaryEncoder";
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
} from "./temperatureEncoderModel";

const FAN_STEPS = ["quiet", "low", "medium low", "medium", "medium high", "high", "turbo"];
const MODE_COLOURS = [MODE_COOL_COLOUR, MODE_FAN_COLOUR, MODE_HEAT_COLOUR];

export type DemoTemperatureDialProps = {
  id: string;
  /** The aircon's four rings, or the heater's one. */
  kind?: "aircon" | "heater";
  room?: number | null;
  size?: number;
  target?: number;
  startMode?: string;
  /** Seconds on the timer at mount, so a demo can show it counting down. */
  timerMinutes?: number;
};

export function DemoTemperatureDial({
  id,
  kind = "aircon",
  room = 21.4,
  size = 200,
  target = 22,
  startMode = "auto",
  timerMinutes = 0,
}: DemoTemperatureDialProps) {
  const [mode, setMode] = useState(startMode);
  const [value, setValue] = useState(target);
  const [modeIndex, setModeIndex] = useState(0);
  const [fanIndex, setFanIndex] = useState(3);
  const [fresh, setFresh] = useState(0);
  const [minutes, setMinutes] = useState(timerMinutes);

  // A set timer counts down, as the real one does.
  useEffect(() => {
    if (minutes <= 0) return;
    const timer = window.setInterval(() => setMinutes((left) => Math.max(0, left - 1)), 60000);
    return () => window.clearInterval(timer);
  }, [minutes]);

  // Same ring visibility as the wired knobs: Manual shows everything, Auto only
  // the timer, Off nothing (specs/temperature-encoder.md).
  const manual = mode === "manual";
  const timerRing: RotaryEncoderRing = {
    id: "timer",
    label: "Timer",
    hidden: mode === "off",
    value: minutes,
    min: 0,
    max: TIMER_MAX_MINUTES,
    step: TIMER_STEP_MINUTES,
    valueText: timerValueText(minutes),
    valueTextWidest: TIMER_VALUE_WIDEST,
    onChange: setMinutes,
  };

  const rings: RotaryEncoderRing[] = kind === "heater"
    ? [timerRing]
    : [
      {
        id: "mode",
        label: "Mode",
        kind: "selector",
        symmetric: true,
        value: modeIndex,
        min: 0,
        max: 2,
        step: 1,
        fill: mode === "off" ? null : MODE_COLOURS[modeIndex],
        hidden: !manual,
        onChange: setModeIndex,
      },
      {
        id: "fan",
        label: "Fan",
        value: fanIndex,
        min: 0,
        max: FAN_STEPS.length - 1,
        step: 1,
        valueText: fanStepText(FAN_STEPS[fanIndex]),
        valueTextWidest: FAN_VALUE_WIDEST,
        hidden: !manual,
        onChange: setFanIndex,
      },
      {
        id: "fresh",
        label: "Fresh Air",
        kind: "toggle",
        value: fresh,
        min: 0,
        max: 1,
        fill: MODE_COOL_COLOUR,
        hidden: !manual,
        onChange: setFresh,
      },
      timerRing,
    ];

  return (
    <div data-demo-knob={id}>
      <TemperatureEncoder
        ariaLabel={`Demo ${kind}`}
        maxTarget={30}
        minTarget={kind === "heater" ? 5 : 16}
        mode={mode}
        modes={kind === "heater"
          ? [{ id: "auto", label: "Auto" }, { id: "off", label: "Off" }]
          : [{ id: "auto", label: "Auto" }, { id: "manual", label: "Manual" }, { id: "off", label: "Off" }]}
        onModeChange={setMode}
        onTargetChange={setValue}
        room={room}
        running={mode !== "off"}
        rings={rings}
        size={size}
        target={value}
      />
    </div>
  );
}
