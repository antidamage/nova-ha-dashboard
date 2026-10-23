import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readPhonoscopeNowPlaying,
  resetPhonoscopeNowPlayingForTest,
  writePhonoscopeNowPlaying,
} from "./phonoscope-now-playing";

describe("phonoscope master clock", () => {
  afterEach(() => {
    resetPhonoscopeNowPlayingForTest();
    vi.useRealTimers();
  });

  it("accounts for Apple TV uplink age and subsequent server time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_250);
    writePhonoscopeNowPlaying({
      position: 5,
      duration: 100,
      playing: true,
      sampledAtMs: 10_000,
      source: "appletv",
    });

    expect(readPhonoscopeNowPlaying(10_750).position).toBeCloseTo(5.75, 6);
  });

  it("ignores implausible wall-clock skew", () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const stored = writePhonoscopeNowPlaying({
      position: 8,
      playing: true,
      sampledAtMs: 1_000,
      source: "appletv",
    });

    expect(stored.position).toBe(8);
  });
});

describe("phonoscope now-playing sources", () => {
  afterEach(() => {
    resetPhonoscopeNowPlayingForTest();
    vi.useRealTimers();
  });

  const report = (source: string, title: string, playing: boolean) => ({
    track: { title, artist: "A", duration: 200 },
    position: 1,
    duration: 200,
    playing,
    sampledAtMs: Date.now(),
    source,
  });

  it("follows the source that most recently started playing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    vi.setSystemTime(2_000);
    writePhonoscopeNowPlaying(report("iphone", "Phone song", true));
    vi.setSystemTime(2_500);
    // The TV keeps reporting the song it was already playing: it does not take over again.
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    expect(readPhonoscopeNowPlaying(2_600)).toMatchObject({ source: "iphone", track: { title: "Phone song" } });
  });

  it("lets a paused source yield to one that is playing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    vi.setSystemTime(2_000);
    writePhonoscopeNowPlaying(report("iphone", "Phone song", false));
    expect(readPhonoscopeNowPlaying(2_100).source).toBe("appletv");
  });

  it("goes back to the other player when one falls silent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    vi.setSystemTime(2_000);
    writePhonoscopeNowPlaying(report("iphone", "Phone song", true));
    vi.setSystemTime(9_500);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    // The phone's last report is now more than eight seconds old.
    expect(readPhonoscopeNowPlaying(10_500).source).toBe("appletv");
  });

  it("holds still while two paused players keep reporting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    vi.setSystemTime(1_500);
    writePhonoscopeNowPlaying(report("appletv", "TV song", false));
    const seen = new Set<string>();
    for (let t = 2_000; t < 5_000; t += 250) {
      vi.setSystemTime(t);
      const phone = t % 500 !== 0;
      writePhonoscopeNowPlaying(report(phone ? "iphone" : "appletv", phone ? "Phone song" : "TV song", false));
      seen.add(readPhonoscopeNowPlaying(t).source);
    }
    // The TV played last, so it stays the one followed: no swap on every post.
    expect([...seen]).toEqual(["appletv"]);
  });

  it("does not hand over at a song change on the other player", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("appletv", "TV song", true));
    vi.setSystemTime(2_000);
    writePhonoscopeNowPlaying(report("iphone", "Phone song", true));
    vi.setSystemTime(3_000);
    // The TV moves on to its next song: a new track is not a new start.
    writePhonoscopeNowPlaying(report("appletv", "TV next song", true));
    expect(readPhonoscopeNowPlaying(3_100).source).toBe("iphone");
  });

  it("is idle when nothing has reported recently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writePhonoscopeNowPlaying(report("iphone", "Phone song", true));
    expect(readPhonoscopeNowPlaying(20_000).source).toBe("idle");
  });
});
