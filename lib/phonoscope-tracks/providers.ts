// Provider lookups: timestamped beats (Spotify, Songle, Essentia), ReccoBeats
// tempo and features, and LRCLIB synced lyrics.
import { fetchJson } from "./client";
import { spotifyAccessToken } from "./store";
import {
  cleanText,
  firstRecord,
  normalizeBeatTimes,
  numberField,
  parseLrc,
  selectSongleCandidate,
} from "./track-model";
import type { PhonoscopeTrackIdentity, TimestampedBeatResult } from "./types";

export async function resolveSpotifyBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
  const token = await spotifyAccessToken();
  const search = new URL("https://api.spotify.com/v1/search");
  search.searchParams.set("q", identity.isrc
    ? `isrc:${identity.isrc}`
    : `track:${identity.title} artist:${identity.artist}`);
  search.searchParams.set("type", "track");
  search.searchParams.set("limit", "5");
  const headers = { Authorization: `Bearer ${token}` };
  const searchPayload = await fetchJson(search, 4_000, { headers });
  const tracks = searchPayload && typeof searchPayload === "object" && !Array.isArray(searchPayload)
    ? (searchPayload as Record<string, unknown>).tracks : null;
  const items = tracks && typeof tracks === "object" && !Array.isArray(tracks)
    ? (tracks as Record<string, unknown>).items : null;
  const candidates = Array.isArray(items) ? items.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const track = candidates
    .map((candidate) => ({
      candidate,
      delta: Math.abs((numberField(candidate, "duration_ms") ?? identity.duration * 1_000) / 1_000 - identity.duration),
    }))
    .filter(({ delta }) => delta <= 2.5)
    .sort((a, b) => a.delta - b.delta)[0];
  const id = cleanText(track?.candidate.id);
  if (!id) throw new Error("no duration-matched track");
  const analysisPayload = await fetchJson(
    new URL(`https://api.spotify.com/v1/audio-analysis/${encodeURIComponent(id)}`),
    5_000,
    { headers },
  );
  if (!analysisPayload || typeof analysisPayload !== "object" || Array.isArray(analysisPayload)) {
    throw new Error("invalid audio analysis");
  }
  const analysis = analysisPayload as Record<string, unknown>;
  const beatTimes = normalizeBeatTimes(analysis.beats, identity.duration);
  if (beatTimes.length < 2) throw new Error("audio analysis contained no usable beats");
  const trackAnalysis = analysis.track && typeof analysis.track === "object" && !Array.isArray(analysis.track)
    ? analysis.track as Record<string, unknown> : null;
  return {
    beatTimes,
    bpm: numberField(trackAnalysis, "tempo"),
    timeSignature: numberField(trackAnalysis, "time_signature"),
    matchConfidence: Math.max(0.8, 1 - (track?.delta ?? 2.5) / 10),
  };
}

export async function resolveSongleBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
  const search = new URL("https://widget.songle.jp/api/v1/songs/search.json");
  search.searchParams.set("q", `${identity.artist} ${identity.title}`);
  const candidate = selectSongleCandidate(await fetchJson(search, 5_000), identity);
  if (!candidate) throw new Error("no duration-matched recording");
  const beatUrl = new URL("https://widget.songle.jp/api/v1/song/beat.json");
  beatUrl.searchParams.set("url", candidate.permalink);
  const payload = await fetchJson(beatUrl, 6_000);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid beat response");
  const record = payload as Record<string, unknown>;
  const beatTimes = normalizeBeatTimes(record.beats, identity.duration, 1 / 1_000);
  if (beatTimes.length < 2) throw new Error("beat response contained no usable beats");
  const firstBeat = Array.isArray(record.beats) ? firstRecord(record.beats) : null;
  return {
    beatTimes,
    bpm: numberField(firstBeat, "bpm"),
    timeSignature: numberField(firstBeat, "count"),
    matchConfidence: Math.max(0.75, 1 - Math.abs(candidate.duration - identity.duration) / 10),
  };
}

export async function resolveEssentiaBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
  const endpoint = process.env.NOVA_PHONOSCOPE_ESSENTIA_URL?.trim();
  if (!endpoint) throw new Error("local analyser endpoint is not configured");
  const payload = await fetchJson(new URL(endpoint), 20_000, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track: identity }),
  });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid analyser response");
  const record = payload as Record<string, unknown>;
  const beatTimes = normalizeBeatTimes(record.beats ?? record.ticks, identity.duration);
  if (beatTimes.length < 2) throw new Error("analyser returned no usable beats");
  return {
    beatTimes,
    bpm: numberField(record, "bpm", "tempo"),
    timeSignature: numberField(record, "timeSignature", "time_signature"),
    matchConfidence: 0.9,
  };
}

export async function resolveReccoBeats(identity: PhonoscopeTrackIdentity) {
  const search = new URL("https://api.reccobeats.com/v1/track");
  if (identity.isrc) search.searchParams.set("isrc", identity.isrc);
  else search.searchParams.set("search", `${identity.artist} ${identity.title}`);
  const searchPayload = await fetchJson(search);
  const track = firstRecord(searchPayload);
  const id = cleanText(track?.id) || cleanText(track?.uuid) || cleanText(track?.href).split("/").filter(Boolean).at(-1);
  if (!id) throw new Error("no matching track id");

  const featuresPayload = await fetchJson(new URL(`https://api.reccobeats.com/v1/track/${encodeURIComponent(id)}/audio-features`));
  const features = firstRecord(featuresPayload);
  const durationMs = numberField(track, "duration_ms", "durationMs");
  const durationSeconds = durationMs ? durationMs / 1_000 : numberField(track, "duration");
  const durationDelta = durationSeconds ? Math.abs(durationSeconds - identity.duration) : 0;
  return {
    matched: durationDelta <= 2,
    matchConfidence: durationSeconds ? Math.max(0, 1 - durationDelta / 10) : 0.72,
    bpm: numberField(features, "tempo", "bpm"),
    energy: numberField(features, "energy"),
    valence: numberField(features, "valence"),
    danceability: numberField(features, "danceability"),
    acousticness: numberField(features, "acousticness"),
    instrumentalness: numberField(features, "instrumentalness"),
    key: cleanText(features?.key) || undefined,
  };
}

export async function resolveLrclib(identity: PhonoscopeTrackIdentity) {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("track_name", identity.title);
  url.searchParams.set("artist_name", identity.artist);
  if (identity.album) url.searchParams.set("album_name", identity.album);
  url.searchParams.set("duration", String(Math.round(identity.duration)));
  const payload = await fetchJson(url);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid response");
  const record = payload as Record<string, unknown>;
  const providerDuration = Number(record.duration);
  if (Number.isFinite(providerDuration) && Math.abs(providerDuration - identity.duration) > 2) {
    throw new Error("duration mismatch");
  }
  return typeof record.syncedLyrics === "string" ? parseLrc(record.syncedLyrics) : [];
}
