import { describe, expect, it } from "vitest";
import { blockStartWallMs, blockStartsForSpan, WASH_BLOCK_MS } from "./history-model";

/**
 * The wash graph's 12-hour blocks are local ones, and this is the arithmetic
 * underneath them (specs/power-meters.md §5.2). Wall-clock values are local
 * date-times written as epoch ms, so the boundaries are plain multiples.
 */

const wall = (iso: string) => Date.parse(`${iso}Z`);

describe("wash blocks", () => {
  it("starts a block at local midnight and at local noon", () => {
    expect(blockStartWallMs(wall("2026-09-22T00:00:00"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T05:31:07"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T11:59:59"))).toBe(wall("2026-09-22T00:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T12:00:00"))).toBe(wall("2026-09-22T12:00:00"));
    expect(blockStartWallMs(wall("2026-09-22T23:59:59"))).toBe(wall("2026-09-22T12:00:00"));
  });

  it("walks every block a span touches, oldest first", () => {
    expect(blockStartsForSpan(wall("2026-09-22T02:00:00"), wall("2026-09-22T04:00:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-22T11:50:00"), wall("2026-09-22T12:40:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
      wall("2026-09-22T12:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-21T22:00:00"), wall("2026-09-22T13:00:00"))).toEqual([
      wall("2026-09-21T12:00:00"),
      wall("2026-09-22T00:00:00"),
      wall("2026-09-22T12:00:00"),
    ]);
  });

  it("gives a span the wrong way round no block, which is what a block read gives it too", () => {
    expect(blockStartsForSpan(wall("2026-09-22T13:00:00"), wall("2026-09-22T11:00:00"))).toEqual([]);
  });

  it("keeps a span that ends exactly on a boundary out of the block starting there", () => {
    // 11:00 to noon: the morning block, and not the one that starts at noon. The
    // step list holds only blocks a wash is actually in, so a wash can never be
    // stepped to and then not be there.
    expect(blockStartsForSpan(wall("2026-09-22T11:00:00"), wall("2026-09-22T12:00:00"))).toEqual([
      wall("2026-09-22T00:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-22T12:00:00"), wall("2026-09-22T13:00:00"))).toEqual([
      wall("2026-09-22T12:00:00"),
    ]);
    expect(blockStartsForSpan(wall("2026-09-22T12:00:00"), wall("2026-09-22T12:00:00"))).toEqual([]);
  });

  it("caps a runaway span, so a stuck open cycle cannot emit blocks for ever", () => {
    const starts = blockStartsForSpan(wall("2026-01-01T00:00:00"), wall("2027-01-01T00:00:00"), 4);
    expect(starts).toHaveLength(4);
    expect(starts[1] - starts[0]).toBe(WASH_BLOCK_MS);
  });
});
