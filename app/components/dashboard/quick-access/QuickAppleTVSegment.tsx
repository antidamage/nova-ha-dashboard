"use client";

/**
 * The Quick Access amplifier tile: the Apple TV dial and its three playlist
 * presets (Adeline, 2026-09-22).
 *
 * The dial is the placeholder for the IR emitter that will drive the amp — it
 * turns, and its lights toggle mute, with nothing sent yet. The playlist row
 * sits under the dial, where the lights segment keeps its own presets, so the
 * two dials on the card's first line read the same way.
 */
import { AppleTVEncoder } from "../../AppleTVEncoder";
import { QuickAppleTVPresets } from "../appleTVPresets";
import { useAppleTVAmp } from "../appleTVAmpClient";
import { QUICK_ENCODER_SIZE } from "./dial-model";
import { QuickSegment } from "./QuickSegment";

export function QuickAppleTVSegment({
  knobSkin,
  size = QUICK_ENCODER_SIZE,
}: {
  /** Forwarded to the dial; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  /** Dial diameter; the card shrinks it to fit a narrow portrait screen. */
  size?: number;
}) {
  const amp = useAppleTVAmp();
  return (
    <QuickSegment className="quick-segment-appletv" label="Apple TV">
      <div className="quick-segment-lead">
        <AppleTVEncoder
          className="quick-access-dial"
          knobSkin={knobSkin}
          muted={amp.muted}
          size={size}
          volume={amp.volume}
          onMuteChange={amp.setMuted}
          onVolumeChange={amp.setVolume}
        />
      </div>
      <QuickAppleTVPresets />
    </QuickSegment>
  );
}
