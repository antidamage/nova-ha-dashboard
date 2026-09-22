"use client";

/**
 * The amplifier dial's playlist presets: one button per preset, on both
 * surfaces the dial is mounted (Adeline, 2026-09-22).
 *
 * The playlist names are long — "Sword Smoke & Temple Drums" is the second of
 * the three shipped ones — so every button carries its name and its playback
 * type as its accessible label and its identity as the icon the editor gave it,
 * the note until one is chosen.
 *
 * **A press is one shot** (Adeline, 2026-09-22): it fires the preset's play
 * event and lights nothing. The store holds no "chosen" preset any more,
 * because a button left lit would read as "this is what is playing now" — an
 * answer only the amplifier could give, and the emitter that will drive it has
 * no endpoint yet.
 */
import {
  playlistModeWords,
  type AppleTVPlaylist,
} from "../../../lib/apple-tv/playlists";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { presetIconComponent, PresetIconMark } from "./appleTVPresetIcon";
import { classNames } from "./shared";
import { useAppleTVAmp } from "./appleTVAmpClient";
import { QuickButton } from "./quick-access/QuickSegment";

/** What a preset is called out loud and in a tooltip. */
function presetLabel(playlist: AppleTVPlaylist) {
  const words = playlistModeWords(playlist);
  return `Play ${playlist.name} on the Apple TV${words.length ? ` (${words.join(", ")})` : ""}`;
}

/** Quick Access: the dial's presets as the card's square icon buttons. */
export function QuickAppleTVPresets({ className }: { className?: string }) {
  const amp = useAppleTVAmp();
  if (!amp.playlists.length) return null;
  return (
    <div className={classNames("quick-button-pair apple-tv-presets", className)} role="group" aria-label="Apple TV playlists">
      {amp.playlists.map((playlist, index) => (
        <QuickButton
          key={`${playlist.name}-${index}`}
          icon={presetIconComponent(playlist.icon)}
          iconOnly
          label={presetLabel(playlist)}
          onClick={() => amp.playPreset(index)}
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
      {amp.playlists.map((playlist, index) => (
        <MomentaryFeedbackButton
          key={`${playlist.name}-${index}`}
          type="button"
          aria-label={presetLabel(playlist)}
          data-preset-icon={playlist.icon ?? "note"}
          onClick={() => amp.playPreset(index)}
        >
          <PresetIconMark icon={playlist.icon} />
        </MomentaryFeedbackButton>
      ))}
    </div>
  );
}
