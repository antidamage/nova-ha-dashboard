/** Saved ranges' decisions and formats, with no I/O. specs/camera-saved-ranges.md. */

export type RangeSegment = {
  offset: number;
  length: number;
  durationSeconds: number;
  /** Wall-clock start of this segment, from the recording's playlist. */
  startsAt: number;
  /** Footage is missing just before this segment. */
  gapBefore?: boolean;
};

export type SavedRangeState = "saving" | "ready" | "failed";

export type SavedRangeMeta = {
  id: string;
  createdAt: string;
  /** Wall-clock span of the footage actually held, once saved; of the selection until then. */
  startMs: number;
  endMs: number;
  durationSeconds: number;
  sizeBytes: number;
  state: SavedRangeState;
  error?: string;
  segments: RangeSegment[];
};

/** What the list shows: everything but the segment table. */
export type SavedRangeSummary = Omit<SavedRangeMeta, "segments"> & { progress?: number };

export type RecordingSegment = { file: string; startsAt: number; durationSeconds: number };

const RANGE_ID = /^range_\d{1,16}$/;
// The recorder puts a run id in the name: seg_mvyi1joi_004201.ts.
const SEGMENT_FILE = /^seg_\w{1,60}\.ts$/;
const MIN_RANGE_MS = 1000;

export function isRangeId(id: string): boolean {
  return RANGE_ID.test(id) && !id.endsWith("\n");
}

/** The recording's segments with their wall-clock times. One with no time cannot be placed. */
export function parseRecordingPlaylist(playlist: string): RecordingSegment[] {
  const segments: RecordingSegment[] = [];
  let durationSeconds = 0;
  let startsAt: number | null = null;
  for (const raw of playlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      durationSeconds = Number.parseFloat(line.slice("#EXTINF:".length)) || 0;
    } else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      const parsed = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
      startsAt = Number.isFinite(parsed) ? parsed : null;
    } else if (line && !line.startsWith("#")) {
      if (SEGMENT_FILE.test(line) && startsAt !== null) {
        segments.push({ file: line, startsAt, durationSeconds });
      }
      // A playlist tags each segment or only the first: carry the clock forward.
      startsAt = startsAt === null ? null : startsAt + durationSeconds * 1000;
    }
  }
  return segments;
}

/** Every segment touching the selection, so the range is never shorter than asked for. */
export function selectSegments(segments: RecordingSegment[], startMs: number, endMs: number): RecordingSegment[] {
  return segments.filter((segment) => segment.startsAt + segment.durationSeconds * 1000 > startMs && segment.startsAt < endMs);
}

export function validSelection(startMs: unknown, endMs: unknown): boolean {
  return typeof startMs === "number" && typeof endMs === "number" && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs >= MIN_RANGE_MS;
}

/** An HLS VOD playlist addressing the one file by byte range. */
export function buildRangePlaylist(segments: RangeSegment[], file = "video.ts"): string {
  const target = Math.ceil(Math.max(1, ...segments.map((segment) => segment.durationSeconds)));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:4", "#EXT-X-PLAYLIST-TYPE:VOD", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0"];
  for (const segment of segments) {
    if (segment.gapBefore) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.startsAt).toISOString()}`,
      `#EXTINF:${segment.durationSeconds.toFixed(3)},`,
      `#EXT-X-BYTERANGE:${segment.length}@${segment.offset}`,
      file,
    );
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** A single `bytes=` range against a file of `size`, or null if it cannot be served. */
export function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    if (suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : size - 1;
  return start > end || start >= size ? null : { start, end };
}

export function downloadName(cameraId: string, startMs: number): string {
  return `${cameraId}-${new Date(startMs).toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "")}-60fps.mp4`;
}
