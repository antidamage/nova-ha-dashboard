"use client";

import { Pause, Play } from "lucide-react";
import { RotaryEncoder } from "../../RotaryEncoder";
import type { EncoderLed } from "../../RotaryEncoder";
import { JOG_DEFAULT_RATE, JOG_STOPS, formatJogRate, jogRateAt, jogStopIndex } from "./jog-model";

const JOG_DIAL_SIZE = 64;
const JOG_RANGE = { min: 0, max: JOG_STOPS.length - 1, step: 1 };

const JOG_LEDS: EncoderLed[] = [
  { id: "play", label: "Play", icon: <Play fill="currentColor" strokeWidth={0} aria-hidden="true" /> },
  { id: "pause", label: "Pause", icon: <Pause fill="currentColor" strokeWidth={0} aria-hidden="true" /> },
];

/**
 * The camera's jog dial. Turning it sets the rate; a tap is play/pause. The mark
 * sits on the set jog, or on 1x with none set, while the face reads the rate
 * actually running, which an unset dial can see differ during catch-up.
 */
export function CameraJogDial({
  jog,
  runningRate,
  playing,
  disabled,
  onRateChange,
  onToggle,
}: {
  jog: number | null;
  runningRate: number;
  playing: boolean;
  disabled: boolean;
  onRateChange: (rate: number) => void;
  onToggle: () => void;
}) {
  return (
    <RotaryEncoder
      ariaLabel="Playback jog"
      ariaValueText={`${formatJogRate(runningRate)}, ${playing ? "playing" : "paused"}`}
      variantClassName="camera-jog-dial"
      disabled={disabled}
      leds={JOG_LEDS}
      ledLabels
      activeLed={playing ? "play" : "pause"}
      onActiveLedChange={onToggle}
      faceTop={formatJogRate(runningRate)}
      color="var(--cyber-cyan)"
      size={JOG_DIAL_SIZE}
      value={jogStopIndex(jog ?? JOG_DEFAULT_RATE)}
      range={JOG_RANGE}
      onChange={(index) => onRateChange(jogRateAt(index))}
    />
  );
}
