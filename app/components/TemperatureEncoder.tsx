"use client";

/**
 * TemperatureEncoder — the climate knob (specs/temperature-encoder.md).
 *
 * The same dial as the lighting knob, set to one job: the knob turns the target
 * temperature and nothing else, whatever mode the room is in. The lights across
 * its face are the modes (Auto / Manual / Off on the aircon, Auto / Off on the
 * heater) and a tap cycles them. The target sits above the lights and the room's
 * own temperature below, smaller. The ring shows both: the target across its top
 * half, the room across its bottom.
 *
 * It tucks itself away after five seconds, and its rings float over the page —
 * both are the base's, see specs/color-encoder.md.
 */
import { useMemo } from "react";
import { RotaryEncoder, type EncoderLed, type RotaryEncoderRing } from "./RotaryEncoder";
import { formatTemperature } from "./dashboard/shared";
import { temperatureColour, temperatureGlow, temperatureRingPaint } from "./temperatureEncoderModel";

/** `22.5°`, or `--` with no reading rather than a degree sign on nothing. */
function degrees(value: number | null) {
  return value === null ? "--" : `${formatTemperature(value)}°`;
}

/** A temperature knob is unusable below this; the lighting knob's floor is 50. */
export const TEMPERATURE_ENCODER_MIN_SIZE = 100;
export const TEMPERATURE_ENCODER_MAX_SIZE = 200;

/** Half a degree (Adeline, 2026-09-12). */
export const TEMPERATURE_STEP_C = 0.5;

/** Five seconds without input and the knob locks, folding its rings away. */
export const TEMPERATURE_TUCK_MS = 5000;

export type TemperatureEncoderProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  knobSkin?: "auto" | "dark" | "light";
  /** The modes, left to right; the lit one is `mode`. */
  modes: EncoderLed[];
  mode: string;
  onModeChange: (mode: string) => void;
  /** What the room is set to, and what it actually is. */
  target: number | null;
  room: number | null;
  minTarget: number;
  maxTarget: number;
  step?: number;
  /** Heating, cooling or fanning right now: the ring glows only then. */
  running?: boolean;
  rings?: RotaryEncoderRing[];
  size?: number;
  onTargetChange: (target: number) => void;
  onTargetCommit?: (target: number) => void;
  onLockChange?: (locked: boolean) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function TemperatureEncoder({
  ariaLabel,
  className,
  disabled = false,
  knobSkin = "auto",
  modes,
  mode,
  onModeChange,
  target,
  room,
  minTarget,
  maxTarget,
  step = TEMPERATURE_STEP_C,
  running = false,
  rings,
  size = TEMPERATURE_ENCODER_MAX_SIZE,
  onTargetChange,
  onTargetCommit,
  onLockChange,
}: TemperatureEncoderProps) {
  const dialSize = clamp(Math.round(size), TEMPERATURE_ENCODER_MIN_SIZE, TEMPERATURE_ENCODER_MAX_SIZE);
  // With no target yet, the knob sits at the middle of its range rather than at
  // an end, so the first turn goes either way.
  const value = typeof target === "number" ? clamp(target, minTarget, maxTarget) : (minTarget + maxTarget) / 2;

  const paint = useMemo(() => temperatureRingPaint(target, room, dialSize), [target, room, dialSize]);
  const glow = useMemo(() => temperatureGlow(target, dialSize, running), [target, dialSize, running]);

  return (
    <RotaryEncoder
      variantClassName="temperature-encoder"
      className={className}
      ariaLabel={ariaLabel}
      ariaValueText={`Target ${formatTemperature(target)} degrees, room ${formatTemperature(room)} degrees`}
      color={temperatureColour(target)}
      ringPaint={paint}
      disabled={disabled}
      faceTop={degrees(target)}
      faceTopClassName="temperature-encoder-target"
      faceBottom={degrees(room)}
      faceBottomClassName="temperature-encoder-room"
      glow={glow}
      knobSkin={knobSkin}
      leds={modes}
      activeLed={mode}
      onActiveLedChange={onModeChange}
      minSize={TEMPERATURE_ENCODER_MIN_SIZE}
      range={{ min: minTarget, max: maxTarget, step }}
      rings={rings}
      size={dialSize}
      tuckAfterMs={TEMPERATURE_TUCK_MS}
      onLockChange={onLockChange}
      value={value}
      onChange={onTargetChange}
      onCommit={onTargetCommit}
    />
  );
}
