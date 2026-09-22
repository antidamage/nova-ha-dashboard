"use client";

/**
 * A preset's playback type, edited in the playlist editor (Adeline,
 * 2026-09-22): whether the preset shuffles, and how it plays through.
 *
 * Two controls rather than one, because they are two independent answers.
 * Shuffle is a switch — on or off — while the repeat button **cycles** the
 * three ways Apple Music plays a playlist through (Adeline's words): looping,
 * play it once, or the endless mode that keeps going after it runs out. The
 * button shows the one it is on, and its accessible name says so too, so a
 * cycling control is never a mystery to a screen reader.
 *
 * Both write straight through to the list, the way every other edit in this
 * editor does — no separate commit step, and a preset is saved whole.
 */
import { Infinity as InfinityIcon, Play, Repeat, Shuffle, type LucideIcon } from "lucide-react";
import {
  REPEAT_MODE_LABELS,
  nextRepeatMode,
  type AppleTVPlaylist,
  type AppleTVRepeatMode,
} from "../../../../lib/apple-tv/playlists";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";

const REPEAT_ICONS: Record<AppleTVRepeatMode, LucideIcon> = {
  off: Play,
  all: Repeat,
  infinite: InfinityIcon,
};

export function AppleTVPlaybackControls({
  index,
  playlist,
  onChange,
}: {
  /** Which row this is, so an unnamed row still reads as one. */
  index: number;
  playlist: AppleTVPlaylist;
  onChange: (patch: Partial<Omit<AppleTVPlaylist, "name">>) => void;
}) {
  const name = playlist.name || `playlist ${index + 1}`;
  const repeatLabel = REPEAT_MODE_LABELS[playlist.repeat];
  const RepeatIcon = REPEAT_ICONS[playlist.repeat];

  return (
    <div className="apple-tv-playlist-playback" role="group" aria-label={`Playback for ${name}`}>
      <MomentaryFeedbackButton
        type="button"
        className="apple-tv-playlist-mode"
        aria-label={`Shuffle ${name}`}
        aria-pressed={playlist.shuffle}
        data-preset-shuffle={playlist.shuffle ? "on" : "off"}
        onClick={() => onChange({ shuffle: !playlist.shuffle })}
      >
        <Shuffle aria-hidden="true" className="h-4 w-4" /><span>Shuffle</span>
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button"
        className="apple-tv-playlist-mode"
        aria-label={`Repeat ${name}: ${repeatLabel}`}
        data-preset-repeat={playlist.repeat}
        onClick={() => onChange({ repeat: nextRepeatMode(playlist.repeat) })}
      >
        <RepeatIcon aria-hidden="true" className="h-4 w-4" /><span>{repeatLabel}</span>
      </MomentaryFeedbackButton>
    </div>
  );
}
