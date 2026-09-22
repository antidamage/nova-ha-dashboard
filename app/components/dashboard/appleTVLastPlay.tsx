"use client";

/**
 * What the Apple TV's app said about the last preset press (Adeline,
 * 2026-09-22).
 *
 * The press hands the playlist's *name* to the app on the television, which
 * resolves it against the Apple Music library — so a name that matches nothing
 * is why a press played nothing, and the app's own words are the useful ones.
 * Its own component because the editor is close to the repo's file-size cap and
 * this is the piece that reads as its own sentence (specs/agent-token-footprint.md).
 */
import type { AppleTVPlayResult } from "./appleTVPlayResult";

export function AppleTVLastPlay({ result }: { result: AppleTVPlayResult }) {
  return (
    <p
      className={`apple-tv-playlists-hint apple-tv-playlists-last-play${result.played ? "" : " apple-tv-playlists-last-play-failed"}`}
    >
      {result.played
        ? `Last press: playing ${result.name}`
        : `Last press: ${result.reason ?? `nothing played for ${result.name}`}`}
    </p>
  );
}
