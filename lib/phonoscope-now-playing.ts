// Now-playing uplink from the Apple TV.
//
// Apple Music plays on the Apple TV through the home theatre, and MusicKit's
// `SystemMusicPlayer` is only observable on that device. When the visualiser
// moved to the GPU renderer on iridium, this became the one signal the thin
// client still has to originate: it posts track identity and transport state a
// few times a second, and everything downstream — beat timeline, theme
// rotation, house-party lighting, the render itself — is derived here.
//
// State is deliberately in-process and unpersisted. It describes "what is
// playing right now", which has no meaning across a restart.
import { publishPhonoscopeConfig } from "./dashboard-events";

export type PhonoscopeNowPlayingTrack = {
  appleMusicId?: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  artworkUrl?: string;
  genreNames?: string[];
};

export type PhonoscopeNowPlaying = {
  track: PhonoscopeNowPlayingTrack | null;
  position: number;
  duration: number;
  playing: boolean;
  /** Wall-clock ms at which the reporter sampled `position`. */
  sampledAtMs: number;
  /** Wall-clock ms at which this server accepted the sample. */
  receivedAtMs: number;
  source: string;
  /** Apple TV's master-clock bar ordinal, used by Nova-owned downbeat themes. */
  barIndex?: number;
};

// A report older than this is treated as nothing playing: the reporter posts at
// ~4 Hz, so several seconds of silence means the app went away rather than that
// the song is merely long.
const STALE_AFTER_MS = 8_000;

type Store = { current: PhonoscopeNowPlaying | null };

const globalWithNowPlaying = globalThis as typeof globalThis & {
  __novaPhonoscopeNowPlaying?: Store;
};

const store =
  globalWithNowPlaying.__novaPhonoscopeNowPlaying ??
  (globalWithNowPlaying.__novaPhonoscopeNowPlaying = { current: null });

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizePhonoscopeNowPlaying(value: unknown): PhonoscopeNowPlaying {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawTrack = (input.track && typeof input.track === "object" ? input.track : null) as
    | Record<string, unknown>
    | null;

  let track: PhonoscopeNowPlayingTrack | null = null;
  if (rawTrack) {
    const title = stringOrUndefined(rawTrack.title);
    const artist = stringOrUndefined(rawTrack.artist);
    // Identity needs at least one of title/artist to be worth resolving.
    if (title || artist) {
      track = {
        appleMusicId: stringOrUndefined(rawTrack.appleMusicId),
        isrc: stringOrUndefined(rawTrack.isrc),
        title: title ?? "",
        artist: artist ?? "",
        album: stringOrUndefined(rawTrack.album),
        duration: Math.max(0, numberOr(rawTrack.duration, 0)),
        artworkUrl: stringOrUndefined(rawTrack.artworkUrl),
        genreNames: Array.isArray(rawTrack.genreNames)
          ? rawTrack.genreNames.filter((entry): entry is string => typeof entry === "string")
          : undefined,
      };
    }
  }

  const receivedAtMs = Date.now();
  const sampledAtMs = numberOr(input.sampledAtMs, receivedAtMs);
  // Correct the position to server receipt before storing it. The Apple TV
  // samples MusicKit before its POST crosses the LAN; ignoring that leg made
  // every downstream extrapolation start late. Bound the correction so a
  // misconfigured wall clock cannot throw the visualiser seconds ahead.
  const sampleAgeMs = Math.abs(receivedAtMs - sampledAtMs) <= 10_000
    ? Math.max(0, Math.min(2_000, receivedAtMs - sampledAtMs))
    : 0;
  const duration = Math.max(0, numberOr(input.duration, track?.duration ?? 0));
  const reportedPosition = Math.max(0, numberOr(input.position, 0));
  const positionAtReceipt = input.playing === true
    ? reportedPosition + sampleAgeMs / 1_000
    : reportedPosition;
  return {
    track,
    position: duration > 0 ? Math.min(duration, positionAtReceipt) : positionAtReceipt,
    duration,
    playing: input.playing === true,
    sampledAtMs,
    receivedAtMs,
    source: stringOrUndefined(input.source) ?? "appletv",
    barIndex: Number.isInteger(input.barIndex) ? Number(input.barIndex) : undefined,
  };
}

export function writePhonoscopeNowPlaying(value: unknown): PhonoscopeNowPlaying {
  const next = normalizePhonoscopeNowPlaying(value);
  const previous = store.current;
  store.current = next;

  // Only a track change is worth waking the renderer's config path; position
  // updates arrive on its own poll and would otherwise spam the SSE bus at 4 Hz.
  const previousKey = previous?.track ? trackKey(previous.track) : "";
  const nextKey = next.track ? trackKey(next.track) : "";
  if (previousKey !== nextKey) publishPhonoscopeConfig("now-playing");
  return next;
}

export function readPhonoscopeNowPlaying(now = Date.now()): PhonoscopeNowPlaying {
  const current = store.current;
  if (!current || now - current.receivedAtMs > STALE_AFTER_MS) {
    return {
      track: null,
      position: 0,
      duration: 0,
      playing: false,
      sampledAtMs: now,
      receivedAtMs: now,
      source: "idle",
      barIndex: undefined,
    };
  }
  // Extrapolate to the moment of the read. The renderer samples this a few
  // times a second but simulates at 120 Hz, so handing it a stale position
  // would make beat phase visibly step.
  const elapsedSeconds = current.playing ? Math.max(0, now - current.receivedAtMs) / 1000 : 0;
  const position = current.duration > 0
    ? Math.min(current.duration, current.position + elapsedSeconds)
    : current.position + elapsedSeconds;
  return { ...current, position };
}

export function trackKey(track: PhonoscopeNowPlayingTrack) {
  if (track.appleMusicId) return track.appleMusicId;
  if (track.isrc) return track.isrc;
  return `${track.artist}|${track.title}`;
}

export function resetPhonoscopeNowPlayingForTest() {
  store.current = null;
}
