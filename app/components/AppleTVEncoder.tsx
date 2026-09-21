"use client";

/**
 * AppleTVEncoder — the amplifier dial (the IR-emitter placeholder).
 *
 * The same dial as the lighting and climate knobs, set to the amp the Apple TV
 * plays through: the knob turns the volume, and the two lights across its face
 * are its modes — volume and mute. Tapping the lights cycles them, and cycling
 * them is what toggles mute (Adeline, 2026-09-22). The ring carries the volume
 * in blue-green, and the name curves over the top.
 *
 * The preset buttons that play an Apple Music playlist live beside it (Quick
 * Access) and under it (the Lounge panel) — they are the caller's, not the
 * dial's, and `AppleTVPresets` is the shared row for both.
 *
 * `RotaryEncoder` carries the base, the drag, the clicks, the tuck-away and the
 * light/dark treatment. Nothing here sends a command: the volume and mute state
 * are the caller's until the IR emitter's endpoint exists.
 */
import { RotaryEncoder, type EncoderLed } from "./RotaryEncoder";
import {
  APPLE_TV_TITLE,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_STEP,
  clampVolume,
  volumeColour,
  volumeGlow,
  volumeLevelText,
  volumeRingPaint,
} from "./appleTVEncoderModel";

/** The two modes, left to right. The lit one is the dial's mode. */
export const APPLE_TV_MODES: EncoderLed[] = [
  { id: "volume", label: "volume" },
  { id: "mute", label: "mute" },
];

/** A dial this small stops reading as a knob; the colour knob's own floor. */
export const APPLE_TV_ENCODER_MIN_SIZE = 50;
export const APPLE_TV_ENCODER_MAX_SIZE = 200;

export type AppleTVEncoderProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  knobSkin?: "auto" | "dark" | "light";
  /** The amplifier is muted. Cycling the modes is the only way to change it. */
  muted: boolean;
  /** Knob diameter in px. */
  size?: number;
  /** The name on the title arc. */
  title?: string;
  /** 0–100. */
  volume: number;
  /** Fires continuously while the knob turns — the preview boundary. */
  onMuteChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  /** Fires once per gesture — the persistence boundary. */
  onVolumeCommit?: (volume: number) => void;
  /** Locks the dial after this long without input, and floats its rings. */
  tuckAfterMs?: number;
  onLockChange?: (locked: boolean) => void;
};

export function AppleTVEncoder({
  ariaLabel,
  className,
  disabled = false,
  knobSkin,
  muted,
  size = APPLE_TV_ENCODER_MAX_SIZE,
  title = APPLE_TV_TITLE,
  volume,
  onMuteChange,
  onVolumeChange,
  onVolumeCommit,
  tuckAfterMs,
  onLockChange,
}: AppleTVEncoderProps) {
  const level = clampVolume(volume);
  /* Clamped once, and used everywhere below: the base clamps whatever it is
     given into `--re-size`, so a dial handed a size outside the contract would
     otherwise draw at the clamp while its glow scaled for the size it was given
     — a halo wider than the knob. The climate knob clamps the same way. */
  const dialSize = Math.max(APPLE_TV_ENCODER_MIN_SIZE, Math.min(APPLE_TV_ENCODER_MAX_SIZE, Math.round(size)));
  /* The lit light is the mode, and the mode is what mute is: entering the mute
     light mutes, and cycling back to volume unmutes. One source of truth, so a
     tap on the lights and a change from anywhere else can never disagree. */
  const mode = muted ? "mute" : "volume";

  return (
    <RotaryEncoder
      variantClassName="apple-tv-encoder"
      className={className}
      ariaLabel={ariaLabel}
      ariaValueText={`volume ${level} percent, ${muted ? "muted" : "unmuted"}`}
      color={volumeColour(level)}
      ringPaint={volumeRingPaint(level, dialSize)}
      disabled={disabled}
      title={title}
      faceTop={volumeLevelText(level)}
      faceTopClassName="apple-tv-encoder-level"
      faceBottom={muted ? "MUTED" : "VOLUME"}
      faceBottomClassName="apple-tv-encoder-mode"
      glow={volumeGlow(level, dialSize, muted)}
      knobSkin={knobSkin}
      leds={APPLE_TV_MODES}
      activeLed={mode}
      onActiveLedChange={(id) => onMuteChange(id === "mute")}
      minSize={APPLE_TV_ENCODER_MIN_SIZE}
      range={{ min: VOLUME_MIN, max: VOLUME_MAX, step: VOLUME_STEP }}
      size={dialSize}
      tuckAfterMs={tuckAfterMs}
      onLockChange={onLockChange}
      value={level}
      onChange={onVolumeChange}
      onCommit={onVolumeCommit}
    />
  );
}
