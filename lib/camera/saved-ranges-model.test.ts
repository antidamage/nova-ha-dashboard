import { describe, expect, it } from "vitest";
import {
  buildRangePlaylist,
  downloadName,
  isRangeId,
  parseByteRange,
  parseRecordingPlaylist,
  selectSegments,
  validSelection,
} from "./saved-ranges-model";

const T = Date.parse("2026-11-02T04:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-TARGETDURATION:2",
  "#EXTINF:2.000000,",
  `#EXT-X-PROGRAM-DATE-TIME:${iso(T)}`,
  "seg_000001.ts",
  "#EXTINF:2.000000,",
  `#EXT-X-PROGRAM-DATE-TIME:${iso(T + 2000)}`,
  "seg_000002.ts",
  "#EXTINF:2.000000,",
  "seg_000003.ts",
  "",
].join("\n");

describe("parseRecordingPlaylist", () => {
  it("gives each segment its time, carrying the clock across an untagged one", () => {
    expect(parseRecordingPlaylist(PLAYLIST)).toEqual([
      { file: "seg_000001.ts", startsAt: T, durationSeconds: 2 },
      { file: "seg_000002.ts", startsAt: T + 2000, durationSeconds: 2 },
      { file: "seg_000003.ts", startsAt: T + 4000, durationSeconds: 2 },
    ]);
  });

  it("reads the recorder's run id in a segment's name", () => {
    const body = `#EXTINF:2,
#EXT-X-PROGRAM-DATE-TIME:${iso(T)}
seg_mvyi1joi_004201.ts
`;
    expect(parseRecordingPlaylist(body).map((s) => s.file)).toEqual(["seg_mvyi1joi_004201.ts"]);
  });

  it("ignores a media line that is not a segment file", () => {
    const body = `#EXTINF:2,\n#EXT-X-PROGRAM-DATE-TIME:${iso(T)}\n../../secret.ts\n`;
    expect(parseRecordingPlaylist(body)).toEqual([]);
  });
});

describe("selectSegments", () => {
  const segments = parseRecordingPlaylist(PLAYLIST);

  it("takes every segment the selection touches", () => {
    expect(selectSegments(segments, T + 1000, T + 3000).map((s) => s.file)).toEqual(["seg_000001.ts", "seg_000002.ts"]);
  });

  it("leaves out segments only touching the selection's edge", () => {
    expect(selectSegments(segments, T + 2000, T + 4000).map((s) => s.file)).toEqual(["seg_000002.ts"]);
  });

  it("finds nothing outside the window", () => {
    expect(selectSegments(segments, T + 60000, T + 70000)).toEqual([]);
  });
});

describe("validSelection", () => {
  it("wants two numbers at least a second apart", () => {
    expect(validSelection(T, T + 1000)).toBe(true);
    expect(validSelection(T, T + 999)).toBe(false);
    expect(validSelection(T + 1000, T)).toBe(false);
    expect(validSelection("1", T)).toBe(false);
    expect(validSelection(Number.NaN, T)).toBe(false);
  });
});

describe("buildRangePlaylist", () => {
  it("addresses the file by byte range and marks a gap", () => {
    const playlist = buildRangePlaylist([
      { offset: 0, length: 100, durationSeconds: 2, startsAt: T },
      { offset: 100, length: 50, durationSeconds: 1.5, startsAt: T + 9000, gapBefore: true },
    ]);
    expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(playlist).toContain("#EXT-X-TARGETDURATION:2");
    expect(playlist).toContain("#EXT-X-BYTERANGE:100@0\nvideo.ts");
    expect(playlist).toContain(`#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:${iso(T + 9000)}\n#EXTINF:1.500,\n#EXT-X-BYTERANGE:50@100`);
    expect(playlist.trim().endsWith("#EXT-X-ENDLIST")).toBe(true);
  });
});

describe("parseByteRange", () => {
  it("reads the three forms", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("clamps an end past the file", () => {
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("refuses what cannot be served", () => {
    for (const header of ["bytes=100-", "bytes=20-10", "bytes=-", "bytes=-0", "items=1-2", "bytes=1-2,4-5"]) {
      expect(parseByteRange(header, 100), header).toBeNull();
    }
  });
});

describe("names", () => {
  it("accepts only a range id", () => {
    expect(isRangeId("range_1793000000000")).toBe(true);
    for (const id of ["range_", "../range_1", "range_1.ts", "snap_1", "range_1\n"]) {
      expect(isRangeId(id), id).toBe(false);
    }
  });

  it("names the download after the footage", () => {
    expect(downloadName("outside", T)).toBe("outside-2026-11-02-04-00-00-60fps.mp4");
  });
});
