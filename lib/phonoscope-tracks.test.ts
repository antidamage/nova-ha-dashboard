import { describe, expect, it } from "vitest";
import { buildBeatTimeline, selectSongleCandidate } from "./phonoscope-tracks";

describe("buildBeatTimeline", () => {
  it("materialises the complete beat file from tempo and offset", () => {
    expect(buildBeatTimeline(2.1, 120, 0.1)).toEqual([0.1, 0.6, 1.1, 1.6, 2.1]);
  });

  it("starts at the first in-range beat for a negative offset", () => {
    expect(buildBeatTimeline(1, 120, -0.2)).toEqual([0.3, 0.8]);
  });

  it("rejects unusable tempo data", () => {
    expect(buildBeatTimeline(180, undefined)).toEqual([]);
    expect(buildBeatTimeline(180, 0)).toEqual([]);
    expect(buildBeatTimeline(180, 500)).toEqual([]);
  });
});

describe("selectSongleCandidate", () => {
  const identity = {
    title: "Get Lucky",
    artist: "Daft Punk",
    duration: 247.98,
  };

  it("selects the same-duration recording instead of a remix or cover", () => {
    expect(selectSongleCandidate({
      value: [
        {
          permalink: "https://example.test/remix",
          title: "Get Lucky (Remix)",
          artist: { name: "DJ Somebody" },
          duration: 247_980,
        },
        {
          permalink: "https://example.test/original",
          title: "Get Lucky (Official Audio)",
          artist: { name: "Daft Punk" },
          duration: 247_980,
        },
      ],
    }, identity)?.permalink).toBe("https://example.test/original");
  });

  it("rejects a title match with the wrong duration", () => {
    expect(selectSongleCandidate({
      value: [{
        permalink: "https://example.test/extended",
        title: "Get Lucky",
        artist: { name: "Daft Punk" },
        duration: 400_250,
      }],
    }, identity)).toBeNull();
  });
});
