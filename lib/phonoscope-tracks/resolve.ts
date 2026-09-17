// Track resolution: cache first, then providers in tier order, with concurrent
// requests for the same track sharing one in-flight resolution.
import { readPhonoscopeConfig } from "../phonoscope-store";
import {
  resolveEssentiaBeats,
  resolveLrclib,
  resolveReccoBeats,
  resolveSongleBeats,
  resolveSpotifyBeats,
} from "./providers";
import { cachePathForTrack, readCachedPhonoscopeTrack, readPhonoscopeTrackOverride, writeJsonAtomic } from "./store";
import { buildBeatTimeline, cleanIdentity, phonoscopeTrackKey } from "./track-model";
import type { PhonoscopeTrackAnalysis, PhonoscopeTrackIdentity, TimestampedBeatResult } from "./types";

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
