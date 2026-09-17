// Pure helpers: identity cleaning and the track key, provider payload readers,
// beat-timeline normalisation and materialisation, Songle matching, LRC parsing.
import { createHash } from "node:crypto";
import type { PhonoscopeTimedLyric, PhonoscopeTrackIdentity, SongleCandidate } from "./types";

export function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 512) : fallback;
}

export function cleanIdentity(value: unknown): PhonoscopeTrackIdentity {
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

export function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined ?? null;
  const record = value as Record<string, unknown>;
  for (const key of ["content", "items", "tracks", "data", "results"]) {
    const nested = firstRecord(record[key]);
    if (nested) return nested;
  }
  return record;
}

export function numberField(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function normalizeBeatTimes(value: unknown, duration: number, scale = 1) {
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

export function parseLrc(value: string): PhonoscopeTimedLyric[] {
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
