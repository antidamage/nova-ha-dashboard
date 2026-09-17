// Track identity, cached analysis and override shapes. The identity fields and
// the override record are matched against the real library and persisted on
// disk, so they must not change shape.
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

export type TimestampedBeatResult = {
  beatTimes: number[];
  bpm?: number;
  timeSignature?: number;
  matchConfidence: number;
};

export type SongleCandidate = {
  permalink: string;
  duration: number;
  title: string;
  artist: string;
};
