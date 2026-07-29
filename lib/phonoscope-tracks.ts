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
  trackKey: string;
  identity: PhonoscopeTrackIdentity;
  matched: boolean;
  matchConfidence: number;
  sourceTier: "timeline" | "bpm" | "metadata";
  bpm?: number;
  beatOffset: number;
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

async function fetchJson(url: URL, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Nova-Phonoscope/1.0 (single-household visualiser)" },
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
  return next;
}

export async function resolvePhonoscopeTrack(value: unknown, force = false): Promise<PhonoscopeTrackAnalysis> {
  const identity = cleanIdentity(value);
  const trackKey = phonoscopeTrackKey(identity);
  const cachePath = path.join(TRACK_ROOT, `${trackKey}.json`);
  if (!force) {
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as PhonoscopeTrackAnalysis;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

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
  const bpm = override.bpm ?? (matched ? reccoResult?.bpm : undefined);
  const lyrics = override.rejectProviderMatch === true ? [] : lyricsResult;
  const analysis: PhonoscopeTrackAnalysis = {
    trackKey,
    identity,
    matched,
    matchConfidence: matched ? reccoResult?.matchConfidence ?? 0.5 : 0,
    sourceTier: lyrics.length ? "timeline" : bpm ? "bpm" : "metadata",
    ...(bpm ? { bpm } : {}),
    beatOffset: override.beatOffset ?? 0,
    timeSignature: override.timeSignature ?? 4,
    ...(matched && reccoResult?.key ? { key: reccoResult.key } : {}),
    ...(matched && reccoResult?.energy !== undefined ? { energy: reccoResult.energy } : {}),
    ...(matched && reccoResult?.valence !== undefined ? { valence: reccoResult.valence } : {}),
    ...(matched && reccoResult?.danceability !== undefined ? { danceability: reccoResult.danceability } : {}),
    ...(matched && reccoResult?.acousticness !== undefined ? { acousticness: reccoResult.acousticness } : {}),
    ...(matched && reccoResult?.instrumentalness !== undefined ? { instrumentalness: reccoResult.instrumentalness } : {}),
    lyrics,
    providers,
    warnings,
    resolvedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(cachePath, analysis);
  return analysis;
}
