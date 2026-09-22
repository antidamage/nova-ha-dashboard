import { describe, expect, it } from "vitest";
import {
  blockStartWallMs,
  blockStartsForSpan,
  wallClockLabel,
  washDurationLabel,
  WASH_BLOCK_MS,
} from "./history-model";

/**
 * The wash graph's day blocks are local ones, and this is the arithmetic
 * underneath them (specs/power-meters.md §5.2). Wall-clock values are local
 * date-times written as epoch ms, so a day boundary is a plain multiple, and the
 * labels drawn under each block are read off the same values.
 */

const wall = (iso: string) => Date.parse(`${iso}Z`);

describe("wash blocks", () => {
  it("starts a block at local midnight, and only there", () => {
    expect(blockStartWallMs(wall("2026-09-22T00:00:00"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T00:00:01"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T11:59:59"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T12:00:00"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T23:59:59"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-23T00:00:00"))).toBe(wall("2026-09-23T00:00:00"));
  });

  it("walks every local day a span touches, oldest first", () => {
    expect(blockStartsForSpan(wall("2026-09-22T02:00:00"), wall("2026-09-22T04:00:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-22T11:50:00"), wall("2026-09-23T00:40:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
      wall("2026-09-23T00:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-21T22:00:00"), wall("2026-09-23T13:00:00"))).toEqual([
      wall("2026-09-21T00:00:00"),
      wall("2026-09-22T00:00:00"),
      wall("2026-09-23T00:00:00"),
    ]);
  });

  it("keeps a same-day span the wrong way round in its own day, which is what a block read gives it too", () => {
    // The read's overlap test is true for it, so the step list must hold its day:
    // dropping it here would hide a wash the day on screen still returns.
    expect(blockStartsForSpan(wall("2026-09-23T13:00:00"), wall("2026-09-23T11:00:00"))).toEqual([
      wall("2026-09-23T00:00:00"),
    ]);
  });

  it("keeps nothing for a span that ends before the day it starts in", () => {
    expect(blockStartsForSpan(wall("2026-09-23T13:00:00"), wall("2026-09-22T11:00:00"))).toEqual([]);
  });

  it("keeps the day for a span with no width inside it, which a fall-back hour can produce", () => {
    // Two instants an hour apart either side of a daylight-saving fall-back read as
    // the same local wall time (02:30 NZDT and 02:30 NZST on 5 Apr 2026), and the
    // caller converts both with localWallMs (lib/power/calendar.ts), so a one-hour
    // wash there arrives at this walk as a span of no width — the value below is
    // what that conversion hands it. The day read still holds the cycle: its
    // overlap test is `from < day end && to > day start`, true for from == to
    // inside the day. So that day must stay steppable.
    expect(blockStartsForSpan(wall("2026-04-05T02:30:00"), wall("2026-04-05T02:30:00"))).toEqual([
      wall("2026-04-05T00:00:00"),
    ]);
  });

  it("keeps a span that ends exactly on midnight out of the day starting there", () => {
    // 11:00 PM to midnight: the day it ran in, and not the one that starts at
    // midnight. The step list holds only days a wash is actually in, so a wash can
    // never be stepped to and then not be there.
    expect(blockStartsForSpan(wall("2026-09-22T23:00:00"), wall("2026-09-23T00:00:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-23T00:00:00"), wall("2026-09-23T01:00:00"))).toEqual([
      wall("2026-09-23T00:00:00"),
    ]);
    // A span with no width right at a boundary starts in no day: the day that
    // begins there needs a strict overlap, and midnight-on-midnight is not one.
    expect(blockStartsForSpan(wall("2026-09-23T00:00:00"), wall("2026-09-23T00:00:00"))).toEqual([]);
  });

  it("caps a runaway span, so a stuck open cycle cannot emit blocks for ever", () => {
    const starts = blockStartsForSpan(wall("2026-01-01T00:00:00"), wall("2027-01-01T00:00:00"), 4);
    expect(starts).toHaveLength(4);
    expect(starts[1] - starts[0]).toBe(WASH_BLOCK_MS);
  });
});

describe("wash labels", () => {
  it("reads a wall-clock value as the household's own clock time", () => {
    expect(wallClockLabel(wall("2026-09-22T00:00:00"))).toBe("12:00 AM");
    expect(wallClockLabel(wall("2026-09-22T02:05:00"))).toBe("2:05 AM");
    expect(wallClockLabel(wall("2026-09-22T12:00:00"))).toBe("12:00 PM");
    expect(wallClockLabel(wall("2026-09-22T13:35:00"))).toBe("1:35 PM");
    expect(wallClockLabel(wall("2026-09-22T23:59:00"))).toBe("11:59 PM");
  });

  it("reads a wash's length to the minute", () => {
    expect(washDurationLabel(48 * 60_000)).toBe("48m");
    expect(washDurationLabel(60 * 60_000)).toBe("1h");
    expect(washDurationLabel((60 + 22) * 60_000)).toBe("1h 22m");
    expect(washDurationLabel(2 * 3_600_000)).toBe("2h");
    // 1m 36s rounds to the nearest minute, and a span the wrong way round cannot
    // read as a negative length.
    expect(washDurationLabel(96_000)).toBe("2m");
    expect(washDurationLabel(-5_000)).toBe("0m");
  });
});
