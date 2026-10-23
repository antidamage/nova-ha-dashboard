// Now-playing uplink from the Apple TV.
//
// Apple Music plays on the Apple TV through the home theatre, and MusicKit's
// `SystemMusicPlayer` is only observable on that device. When the visualiser
// moved to the GPU renderer on voiceHost, this became the one signal the thin
// client still has to originate: it posts track identity and transport state a
// few times a second, and everything downstream — beat timeline, theme
// rotation, house-party lighting, the render itself — is derived here.
//
// More than one player can report: the Apple TV (`appletv`) and the Nova phone
// app (`iphone`). Each source keeps its own report, and the visualiser follows
// the one that most recently started playing; a paused or silent source yields
// to one that is playing (nova-appletv-dashboard `specs/ios-touch-app.md`).
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

// A source silent this long is forgotten, so the table holds only live players.
const FORGET_AFTER_MS = 60_000;

type SourceReport = {
  report: PhonoscopeNowPlaying;
  /** When this source last went from stopped to playing. A new track while it plays is not a start. */
  startedAtMs: number;
  /** When it last reported playing; 0 if it never has. */
  lastPlayingAtMs: number;
};

type Store = {
  sources: Record<string, SourceReport>;
  /** The source the visualiser is following, kept until another one wins. */
  selected?: string;
};

const globalWithNowPlaying = globalThis as typeof globalThis & {
  __novaPhonoscopeNowPlaying?: Store;
};

const store =
  globalWithNowPlaying.__novaPhonoscopeNowPlaying ??
  (globalWithNowPlaying.__novaPhonoscopeNowPlaying = { sources: {} });
// A store created by an older module version during a dev hot reload.
if (!store.sources) store.sources = {};

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

/**
 * The source the visualiser follows, of those heard from in the last
 * `STALE_AFTER_MS`: the playing one that started most recently. With nothing
 * playing it stays on the source it was following while that one still reports,
 * else the one that played last — never on whichever paused player posted last,
 * which at 4 Hz from two paused players would swap on every post.
 */
function selectedSource(now: number): string | null {
  const live = Object.entries(store.sources).filter(([, entry]) => now - entry.report.receivedAtMs <= STALE_AFTER_MS);
  if (!live.length) return null;
  const isSelected = (name: string) => (name === store.selected ? 1 : 0);
  const playing = live.filter(([, entry]) => entry.report.playing);
  if (playing.length) {
    return playing.reduce((a, b) =>
      b[1].startedAtMs > a[1].startedAtMs || (b[1].startedAtMs === a[1].startedAtMs && isSelected(b[0]) > isSelected(a[0]))
        ? b : a)[0];
  }
  if (store.selected && live.some(([name]) => name === store.selected)) return store.selected;
  return live.reduce((a, b) =>
    b[1].lastPlayingAtMs > a[1].lastPlayingAtMs
    || (b[1].lastPlayingAtMs === a[1].lastPlayingAtMs && b[1].report.receivedAtMs > a[1].report.receivedAtMs)
      ? b : a)[0];
}

function selectedReport(now: number): PhonoscopeNowPlaying | null {
  const name = selectedSource(now);
  return name ? store.sources[name].report : null;
}

export function writePhonoscopeNowPlaying(value: unknown): PhonoscopeNowPlaying {
  const next = normalizePhonoscopeNowPlaying(value);
  const now = next.receivedAtMs;
  const previous = selectedReport(now);
  for (const [name, entry] of Object.entries(store.sources)) {
    if (now - entry.report.receivedAtMs > FORGET_AFTER_MS) delete store.sources[name];
  }
  const before = store.sources[next.source];
  const wasPlaying = before !== undefined && before.report.playing
    && now - before.report.receivedAtMs <= STALE_AFTER_MS;
  store.sources[next.source] = {
    report: next,
    startedAtMs: next.playing && !wasPlaying ? now : before?.startedAtMs ?? now,
    lastPlayingAtMs: next.playing ? now : before?.lastPlayingAtMs ?? 0,
  };
  store.selected = selectedSource(now) ?? undefined;
  const selected = selectedReport(now);

  // Only a track change is worth waking the renderer's config path; position
  // updates arrive on its own poll and would otherwise spam the SSE bus at 4 Hz.
  const previousKey = previous?.track ? trackKey(previous.track) : "";
  const nextKey = selected?.track ? trackKey(selected.track) : "";
  if (previousKey !== nextKey) publishPhonoscopeConfig("now-playing");
  return next;
}

export function readPhonoscopeNowPlaying(now = Date.now()): PhonoscopeNowPlaying {
  const current = selectedReport(now);
  if (!current) {
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
  store.sources = {};
  store.selected = undefined;
}
