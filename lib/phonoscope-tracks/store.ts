// The phonoscope-tracks package's only owner of state: the track cache and
// overrides file under TRACK_ROOT (atomic write-then-rename), and the in-memory
// Spotify access-token cache.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchJson } from "./client";
import { buildBeatTimeline, cleanText } from "./track-model";
import type { PhonoscopeTrackAnalysis, PhonoscopeTrackOverride } from "./types";

const TRACK_ROOT =
  process.env.NOVA_PHONOSCOPE_TRACKS_DIR ?? path.join(process.cwd(), "data", "phonoscope", "tracks");
const OVERRIDES_PATH = path.join(TRACK_ROOT, "overrides.json");

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

export async function spotifyAccessToken() {
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

async function readOverrides(): Promise<Record<string, PhonoscopeTrackOverride>> {
  try {
    return JSON.parse(await readFile(OVERRIDES_PATH, "utf8")) as Record<string, PhonoscopeTrackOverride>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function cachePathForTrack(trackKey: string) {
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
