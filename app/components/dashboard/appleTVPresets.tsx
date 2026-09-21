"use client";

/**
 * The amplifier dial's playlist presets: one button per playlist, on both
 * surfaces the dial is mounted (Adeline, 2026-09-22).
 *
 * The playlist names are long — "Sword Smoke & Temple Drums" is the second of
 * the three shipped ones — so every button carries its name as its accessible
 * label and its visual identity as the note glyph: the chosen one is the only
 * one that changes appearance. Nothing is sent anywhere yet; pressing one marks
 * it, which is what the layout has to be judged on until the IR emitter's
 * endpoint exists.
 */
import { Music } from "lucide-react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { classNames } from "./shared";
import { useAppleTVAmp } from "./appleTVAmpClient";
import { QuickButton } from "./quick-access/QuickSegment";

/** What a preset is called out loud and in a tooltip. */
function presetLabel(name: string) {
  return `Play ${name} on the Apple TV`;
}

/** Quick Access: the dial's presets as the card's square icon buttons. */
export function QuickAppleTVPresets({ className }: { className?: string }) {
  const amp = useAppleTVAmp();
  if (!amp.playlists.length) return null;
  return (
    <div className={classNames("quick-button-pair apple-tv-presets", className)} role="group" aria-label="Apple TV playlists">
      {amp.playlists.map((name, index) => (
        <QuickButton
          key={`${name}-${index}`}
          active={amp.presetIndex === index}
          icon={Music}
          iconOnly
          label={presetLabel(name)}
          pressed={amp.presetIndex === index}
          onClick={() => amp.choosePreset(index)}
        />
      ))}
    </div>
  );
}

/**
 * A zone panel: the same presets in the panel's own preset row, icon-only and
 * at the row's height, so the dial's buttons line up with the lighting preset
 * row beside them rather than sitting at a second, smaller size.
 */
export function PanelAppleTVPresets({ className }: { className?: string }) {
  const amp = useAppleTVAmp();
  if (!amp.playlists.length) return null;
  return (
    <div
      className={classNames("zone-lighting-presets apple-tv-presets", className)}
      data-preset-count={amp.playlists.length}
      role="group"
      aria-label="Apple TV playlists"
    >
      {amp.playlists.map((name, index) => (
        <MomentaryFeedbackButton
          key={`${name}-${index}`}
          type="button"
          aria-label={presetLabel(name)}
          aria-pressed={amp.presetIndex === index}
          data-preset-active={amp.presetIndex === index ? "true" : undefined}
          onClick={() => amp.choosePreset(index)}
        >
          <Music aria-hidden="true" />
        </MomentaryFeedbackButton>
      ))}
    </div>
  );
}
