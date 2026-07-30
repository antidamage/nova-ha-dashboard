import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readPhonoscopeConfig } from "./phonoscope-store";

const TRACK_ROOT =
  process.env.NOVA_PHONOSCOPE_TRACKS_DIR ?? path.join(process.cwd(), "data", "phonoscope", "tracks");
const OVERRIDES_PATH = path.join(TRACK_ROOT, "overrides.json");

export type PhonoscopeTrackIdentity = {
  appleMusicId?: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  artworkUrl?: string;
};

export type PhonoscopeTimedLyric = {
  time: number;
  text: string;
};

export type PhonoscopeTrackAnalysis = {
  cacheVersion: 3;
  trackKey: string;
  identity: PhonoscopeTrackIdentity;
  matched: boolean;
  matchConfidence: number;
  sourceTier: "timeline" | "bpm" | "metadata";
  bpm?: number;
  beatOffset: number;
  beatTimes: number[];
  beatSource: "spotify-timestamps" | "songle-timestamps" | "essentia-timestamps"
    | "reccobeats-tempo" | "override-tempo" | "none";
  timeSignature: number;
  key?: string;
  energy?: number;
  valence?: number;
  danceability?: number;
  acousticness?: number;
  instrumentalness?: number;
  mood?: string;
  lyrics: PhonoscopeTimedLyric[];
  providers: string[];
  warnings: string[];
  resolvedAt: string;
};

export type PhonoscopeTrackOverride = {
  bpm?: number;
  beatOffset?: number;
  timeSignature?: number;
  rejectProviderMatch?: boolean;
};

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 512) : fallback;
}

function cleanIdentity(value: unknown): PhonoscopeTrackIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected track identity");
  const raw = value as Record<string, unknown>;
  const title = cleanText(raw.title);
  const artist = cleanText(raw.artist);
  const duration = Number(raw.duration);
  if (!title || !artist || !Number.isFinite(duration) || duration <= 0 || duration > 86_400) {
    throw new Error("Track identity requires title, artist, and a finite duration in seconds");
  }
  const isrc = cleanText(raw.isrc).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return {
    ...(cleanText(raw.appleMusicId) ? { appleMusicId: cleanText(raw.appleMusicId) } : {}),
    ...(isrc.length >= 10 && isrc.length <= 15 ? { isrc } : {}),
    title,
    artist,
    ...(cleanText(raw.album) ? { album: cleanText(raw.album) } : {}),
    duration,
    ...(cleanText(raw.artworkUrl) ? { artworkUrl: cleanText(raw.artworkUrl) } : {}),
  };
}

export function phonoscopeTrackKey(identity: PhonoscopeTrackIdentity) {
  const source = identity.isrc
    ? `isrc:${identity.isrc}:${Math.round(identity.duration)}`
    : `meta:${identity.artist.toLowerCase()}:${identity.title.toLowerCase()}:${Math.round(identity.duration)}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}

async function fetchJson(url: URL, timeoutMs = 4_000, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "Nova-Phonoscope/1.0 (single-household visualiser)");
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined ?? null;
  const record = value as Record<string, unknown>;
  for (const key of ["content", "items", "tracks", "data", "results"]) {
    const nested = firstRecord(record[key]);
    if (nested) return nested;
  }
  return record;
}

function numberField(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

type TimestampedBeatResult = {
  beatTimes: number[];
  bpm?: number;
  timeSignature?: number;
  matchConfidence: number;
};

function normalizeBeatTimes(value: unknown, duration: number, scale = 1) {
  if (!Array.isArray(value)) return [];
  let previous = -1;
  return value.flatMap((entry) => {
    const raw = typeof entry === "number"
      ? entry
      : entry && typeof entry === "object"
        ? numberField(entry as Record<string, unknown>, "start", "time", "timestamp")
        : undefined;
    const time = raw === undefined ? NaN : raw * scale;
    if (!Number.isFinite(time) || time < 0 || time > duration + 0.25 || time <= previous) return [];
    previous = time;
    return [Number(time.toFixed(6))];
  }).slice(0, 100_000);
}

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

async function spotifyAccessToken() {
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 30_000) return spotifyTokenCache.token;
  const clientId = process.env.NOVA_SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.NOVA_SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("credentials are not configured");
  const payload = await fetchJson(new URL("https://accounts.spotify.com/api/token"), 4_000, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid token response");
  const record = payload as Record<string, unknown>;
  const token = cleanText(record.access_token);
  if (!token) throw new Error("token response contained no access token");
  spotifyTokenCache = {
    token,
    expiresAt: Date.now() + Math.max(60, Number(record.expires_in) || 3_600) * 1_000,
  };
  return token;
}

async function resolveSpotifyBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
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

type SongleCandidate = {
  permalink: string;
  duration: number;
  title: string;
  artist: string;
};

function normalizeMatchText(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function selectSongleCandidate(value: unknown, identity: PhonoscopeTrackIdentity): SongleCandidate | null {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).value)
      ? (value as Record<string, unknown>).value as unknown[] : [];
  const wantedTitle = normalizeMatchText(identity.title);
  const wantedArtist = normalizeMatchText(identity.artist);
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const artistRecord = record.artist && typeof record.artist === "object" && !Array.isArray(record.artist)
      ? record.artist as Record<string, unknown> : null;
    const permalink = cleanText(record.permalink);
    const duration = (numberField(record, "duration") ?? 0) / 1_000;
    const title = cleanText(record.title);
    const artist = cleanText(artistRecord?.name);
    const delta = Math.abs(duration - identity.duration);
    const normalizedTitle = normalizeMatchText(title);
    const normalizedArtist = normalizeMatchText(artist);
    if (!normalizedTitle || !normalizedArtist) return [];
    const titleMatch = normalizedTitle.includes(wantedTitle) || wantedTitle.includes(normalizedTitle);
    const artistMatch = normalizedArtist.includes(wantedArtist) || wantedArtist.includes(normalizedArtist)
      || normalizedTitle.includes(wantedArtist);
    if (!permalink || delta > 2.5 || !titleMatch || !artistMatch) return [];
    return [{ permalink, duration, title, artist, delta }];
  }).sort((a, b) => a.delta - b.delta)[0] ?? null;
}

async function resolveSongleBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
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

async function resolveEssentiaBeats(identity: PhonoscopeTrackIdentity): Promise<TimestampedBeatResult> {
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

/**
 * ReccoBeats currently supplies a track-wide tempo rather than timestamped
 * beats. Nova materialises that tempo into a canonical, cacheable beat file so
 * clients all consume the same timeline and never need to contact the provider.
 */
export function buildBeatTimeline(duration: number, bpm: number | undefined, beatOffset = 0) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(bpm) || !bpm || bpm < 20 || bpm > 400) {
    return [];
  }
  const interval = 60 / bpm;
  const firstIndex = Math.max(0, Math.ceil((0 - beatOffset) / interval));
  const beats: number[] = [];
  for (let index = firstIndex; beats.length < 100_000; index += 1) {
    const time = beatOffset + index * interval;
    if (time > duration + 0.000_001) break;
    beats.push(Number(time.toFixed(6)));
  }
  return beats;
}

async function resolveReccoBeats(identity: PhonoscopeTrackIdentity) {
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

function parseLrc(value: string): PhonoscopeTimedLyric[] {
  const lines: PhonoscopeTimedLyric[] = [];
  for (const line of value.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) continue;
    for (const match of matches) {
      const time = Number(match[1]) * 60 + Number(match[2]);
      if (Number.isFinite(time)) lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 10_000);
}

async function resolveLrclib(identity: PhonoscopeTrackIdentity) {
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

async function readOverrides(): Promise<Record<string, PhonoscopeTrackOverride>> {
  try {
    return JSON.parse(await readFile(OVERRIDES_PATH, "utf8")) as Record<string, PhonoscopeTrackOverride>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function cachePathForTrack(trackKey: string) {
  if (!/^[a-f0-9]{24}$/.test(trackKey)) throw new Error("Invalid track key");
  return path.join(TRACK_ROOT, `${trackKey}.json`);
}

function upgradeCachedAnalysis(value: PhonoscopeTrackAnalysis) {
  const beatOffset = Number.isFinite(value.beatOffset) ? value.beatOffset : 0;
  const beatTimes = Array.isArray(value.beatTimes)
    ? value.beatTimes.filter((time) => Number.isFinite(time) && time >= 0 && time <= value.identity.duration)
    : buildBeatTimeline(value.identity.duration, value.bpm, beatOffset);
  return {
    ...value,
    cacheVersion: 3 as const,
    beatOffset,
    beatTimes,
    beatSource: value.beatSource
      ?? (value.bpm ? (value.providers?.includes("reccobeats") ? "reccobeats-tempo" : "override-tempo") : "none"),
    sourceTier: beatTimes.length || value.lyrics?.length ? "timeline" as const
      : value.bpm ? "bpm" as const : "metadata" as const,
  };
}

export async function readCachedPhonoscopeTrack(trackKey: string) {
  const cachePath = cachePathForTrack(trackKey);
  const cached = JSON.parse(await readFile(cachePath, "utf8")) as PhonoscopeTrackAnalysis;
  const upgraded = upgradeCachedAnalysis(cached);
  if (cached.cacheVersion !== 3 || !Array.isArray(cached.beatTimes)) {
    await writeJsonAtomic(cachePath, upgraded);
  }
  return upgraded;
}

export async function readPhonoscopeTrackOverride(trackKey: string) {
  return (await readOverrides())[trackKey] ?? {};
}

export async function writePhonoscopeTrackOverride(trackKey: string, value: unknown) {
  if (!/^[a-f0-9]{24}$/.test(trackKey)) throw new Error("Invalid track key");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected override object");
  const raw = value as Record<string, unknown>;
  const next: PhonoscopeTrackOverride = {};
  if (raw.bpm !== undefined) {
    const bpm = Number(raw.bpm);
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new Error("BPM must be between 20 and 400");
    next.bpm = bpm;
  }
  if (raw.beatOffset !== undefined) {
    const beatOffset = Number(raw.beatOffset);
    if (!Number.isFinite(beatOffset) || beatOffset < -60 || beatOffset > 60) throw new Error("Beat offset must be between -60 and 60 seconds");
    next.beatOffset = beatOffset;
  }
  if (raw.timeSignature !== undefined) {
    const timeSignature = Number(raw.timeSignature);
    if (!Number.isInteger(timeSignature) || timeSignature < 1 || timeSignature > 16) throw new Error("Time signature must be 1-16");
    next.timeSignature = timeSignature;
  }
  if (typeof raw.rejectProviderMatch === "boolean") next.rejectProviderMatch = raw.rejectProviderMatch;
  const overrides = await readOverrides();
  overrides[trackKey] = next;
  await writeJsonAtomic(OVERRIDES_PATH, overrides);
  try {
    const cached = await readCachedPhonoscopeTrack(trackKey);
    const bpm = next.bpm ?? cached.bpm;
    const beatOffset = next.beatOffset ?? cached.beatOffset;
    await writeJsonAtomic(cachePathForTrack(trackKey), {
      ...cached,
      ...(bpm ? { bpm } : {}),
      beatOffset,
      timeSignature: next.timeSignature ?? cached.timeSignature,
      beatTimes: buildBeatTimeline(cached.identity.duration, bpm, beatOffset),
      beatSource: next.bpm !== undefined || next.beatOffset !== undefined ? "override-tempo" : cached.beatSource,
      resolvedAt: new Date().toISOString(),
    } satisfies PhonoscopeTrackAnalysis);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return next;
}

const resolutionsInFlight = new Map<string, Promise<PhonoscopeTrackAnalysis>>();

async function resolvePhonoscopeTrackUncached(
  identity: PhonoscopeTrackIdentity,
  trackKey: string,
): Promise<PhonoscopeTrackAnalysis> {
  const config = await readPhonoscopeConfig();
  const warnings: string[] = [];
  const providers: string[] = [];
  const [reccoResult, lyricsResult] = await Promise.all([
    config.providers.reccoBeats
      ? resolveReccoBeats(identity).then((result) => {
          providers.push("reccobeats");
          return result;
        }).catch((error) => {
          warnings.push(`ReccoBeats: ${error instanceof Error ? error.message : "lookup failed"}`);
          return null;
        })
      : null,
    config.providers.lrclib
      ? resolveLrclib(identity).then((result) => {
          providers.push("lrclib");
          return result;
        }).catch((error) => {
          warnings.push(`LRCLIB: ${error instanceof Error ? error.message : "lookup failed"}`);
          return [];
        })
      : [],
  ]);
  const override = await readPhonoscopeTrackOverride(trackKey);
  const matched = reccoResult?.matched === true && override.rejectProviderMatch !== true;
  const beatOffset = override.beatOffset ?? 0;
  let timestampResult: TimestampedBeatResult | null = null;
  let timestampSource: PhonoscopeTrackAnalysis["beatSource"] = "none";
  if (override.bpm === undefined && override.beatOffset === undefined && override.rejectProviderMatch !== true) {
    const timestampProviders: Array<{
      enabled: boolean;
      name: string;
      source: PhonoscopeTrackAnalysis["beatSource"];
      resolve: () => Promise<TimestampedBeatResult>;
    }> = [
      {
        enabled: config.providers.spotify === true,
        name: "Spotify",
        source: "spotify-timestamps",
        resolve: () => resolveSpotifyBeats(identity),
      },
      {
        enabled: config.providers.songle === true,
        name: "Songle",
        source: "songle-timestamps",
        resolve: () => resolveSongleBeats(identity),
      },
      {
        enabled: config.providers.essentia === true,
        name: "Essentia",
        source: "essentia-timestamps",
        resolve: () => resolveEssentiaBeats(identity),
      },
    ];
    for (const provider of timestampProviders) {
      if (!provider.enabled) continue;
      try {
        timestampResult = await provider.resolve();
        timestampSource = provider.source;
        providers.push(provider.name.toLocaleLowerCase());
        break;
      } catch (error) {
        warnings.push(`${provider.name}: ${error instanceof Error ? error.message : "lookup failed"}`);
      }
    }
  }
  const bpm = override.bpm ?? timestampResult?.bpm ?? (matched ? reccoResult?.bpm : undefined);
  const beatTimes = timestampResult?.beatTimes ?? buildBeatTimeline(identity.duration, bpm, beatOffset);
  const lyrics = override.rejectProviderMatch === true ? [] : lyricsResult;
  const analysis: PhonoscopeTrackAnalysis = {
    cacheVersion: 3,
    trackKey,
    identity,
    matched: Boolean(timestampResult) || matched,
    matchConfidence: timestampResult?.matchConfidence ?? (matched ? reccoResult?.matchConfidence ?? 0.5 : 0),
    sourceTier: beatTimes.length || lyrics.length ? "timeline" : bpm ? "bpm" : "metadata",
    ...(bpm ? { bpm } : {}),
    beatOffset,
    beatTimes,
    beatSource: timestampResult
      ? timestampSource
      : bpm
        ? (override.bpm !== undefined || override.beatOffset !== undefined ? "override-tempo" : "reccobeats-tempo")
        : "none",
    timeSignature: override.timeSignature ?? timestampResult?.timeSignature ?? 4,
    ...(matched && reccoResult?.key ? { key: reccoResult.key } : {}),
    ...(matched && reccoResult?.energy !== undefined ? { energy: reccoResult.energy } : {}),
    ...(matched && reccoResult?.valence !== undefined ? { valence: reccoResult.valence } : {}),
    ...(matched && reccoResult?.danceability !== undefined ? { danceability: reccoResult.danceability } : {}),
    ...(matched && reccoResult?.acousticness !== undefined ? { acousticness: reccoResult.acousticness } : {}),
    ...(matched && reccoResult?.instrumentalness !== undefined ? { instrumentalness: reccoResult.instrumentalness } : {}),
    lyrics,
    providers: [...new Set(providers)],
    warnings,
    resolvedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(cachePathForTrack(trackKey), analysis);
  return analysis;
}

export async function resolvePhonoscopeTrack(value: unknown, force = false): Promise<PhonoscopeTrackAnalysis> {
  const identity = cleanIdentity(value);
  const trackKey = phonoscopeTrackKey(identity);
  if (!force) {
    try {
      return await readCachedPhonoscopeTrack(trackKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const existing = resolutionsInFlight.get(trackKey);
  if (existing) return existing;
  const resolution = resolvePhonoscopeTrackUncached(identity, trackKey)
    .finally(() => resolutionsInFlight.delete(trackKey));
  resolutionsInFlight.set(trackKey, resolution);
  return resolution;
}
