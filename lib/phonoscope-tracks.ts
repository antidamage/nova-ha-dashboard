/**
 * Phonoscope track analysis: beat timelines, audio features and synced lyrics
 * per track, cached on disk — facade. The body lives in lib/phonoscope-tracks/;
 * this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3). Server-only: store.ts uses fs.
 *
 *   phonoscope-tracks/types.ts        identity, analysis, override, provider result shapes
 *   phonoscope-tracks/client.ts       fetchJson, the outbound HTTP helper
 *   phonoscope-tracks/track-model.ts  identity cleaning, track key, beat timelines, Songle matching, LRC
 *   phonoscope-tracks/providers.ts    Spotify, Songle, Essentia, ReccoBeats and LRCLIB lookups
 *   phonoscope-tracks/store.ts        SOLE owner of state: track cache, overrides file, Spotify token
 *   phonoscope-tracks/resolve.ts      resolvePhonoscopeTrack and its in-flight dedup
 */
export type {
  PhonoscopeTimedLyric,
  PhonoscopeTrackAnalysis,
  PhonoscopeTrackIdentity,
  PhonoscopeTrackOverride,
} from "./phonoscope-tracks/types";
export { buildBeatTimeline, phonoscopeTrackKey, selectSongleCandidate } from "./phonoscope-tracks/track-model";
export {
  readCachedPhonoscopeTrack,
  readPhonoscopeTrackOverride,
  writePhonoscopeTrackOverride,
} from "./phonoscope-tracks/store";
export { resolvePhonoscopeTrack } from "./phonoscope-tracks/resolve";
