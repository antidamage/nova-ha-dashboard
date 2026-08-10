import { describe, expect, it } from "vitest";
import { sliceLivePlaylist } from "./hls-playlist";

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:40
#EXTINF:2.0,
#EXT-X-PROGRAM-DATE-TIME:2026-08-10T10:00:00.000Z
seg_000040.ts
#EXTINF:2.0,
#EXT-X-PROGRAM-DATE-TIME:2026-08-10T10:00:02.000Z
seg_000041.ts
#EXTINF:2.0,
#EXT-X-PROGRAM-DATE-TIME:2026-08-10T10:00:04.000Z
seg_000042.ts
`;

describe("sliceLivePlaylist", () => {
  it("opens at the segment containing the requested wall-clock instant", () => {
    const result = sliceLivePlaylist(PLAYLIST, Date.parse("2026-08-10T10:00:03.000Z"));
    expect(result).not.toContain("seg_000040.ts");
    expect(result).toContain("seg_000041.ts");
    expect(result).toContain("seg_000042.ts");
    expect(result).toContain("#EXT-X-MEDIA-SEQUENCE:41");
    expect(result).toContain("#EXT-X-START:TIME-OFFSET=0,PRECISE=NO");
  });

  it("returns an unparseable manifest unchanged", () => {
    expect(sliceLivePlaylist("#EXTM3U\n", Date.now())).toBe("#EXTM3U\n");
  });
});
