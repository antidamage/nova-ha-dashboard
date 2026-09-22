import { describe, expect, it } from "vitest";
import type { WashBlock, WashGraphCycle } from "../../../../../lib/power";
import { personColor, washPlacement, washStep } from "./wash-timeline";

/**
 * The graph's own maths (specs/power-meters.md §5.2): where a wash sits across the
 * block on show, and where a step lands. The blocks it steps through hold a wash
 * by construction, which is what makes a step skip the blocks that hold none.
 */

const BLOCK: WashBlock = {
  dateLabel: "Sat 19 Sep 2026",
  endLabel: "12:00 PM",
  endMs: Date.parse("2026-09-19T00:00:00.000Z"),
  startLabel: "12:00 AM",
  startMs: Date.parse("2026-09-18T12:00:00.000Z"),
};

const HOUR = 3_600_000;
const wash = (startHours: number, endHours: number) =>
  ({
    endedAt: new Date(BLOCK.startMs + endHours * HOUR).toISOString(),
    startedAt: new Date(BLOCK.startMs + startHours * HOUR).toISOString(),
  }) as WashGraphCycle;

describe("washPlacement", () => {
  it("places a wash across the block by its own clock time", () => {
    expect(washPlacement(wash(3, 9), BLOCK)).toEqual({ left: 25, width: 50 });
  });

  it("clips a wash that started before the block, keeping its width", () => {
    expect(washPlacement(wash(-2, 1), BLOCK)).toEqual({ left: 0, width: 25 });
  });

  it("keeps a late wash's touch width inside the block", () => {
    const { left, width } = washPlacement(wash(11.5, 11.83), BLOCK);
    expect(width).toBe(14);
    expect(left + width).toBe(100);
  });

  it("gives a short wash the width of a touch target", () => {
    expect(washPlacement(wash(0, 0.2), BLOCK).width).toBe(14);
  });
});

describe("washStep", () => {
  const blocks = [30, 10, 20, 20];

  it("steps back from the newest block to the one before it, skipping the empty ones", () => {
    expect(washStep(blocks, null, -1)).toBe(20);
  });

  it("holds the newest block as the follow state, which is never a block number", () => {
    expect(washStep(blocks, 20, 1)).toBeNull();
  });

  it("steps either way between the blocks it has", () => {
    expect(washStep(blocks, 20, -1)).toBe(10);
    expect(washStep(blocks, 10, 1)).toBe(20);
  });

  it("has nowhere to go at either end", () => {
    expect(washStep(blocks, 10, -1)).toBeUndefined();
    expect(washStep(blocks, null, 1)).toBeUndefined();
  });

  it("has nowhere to go with no blocks at all", () => {
    expect(washStep([], null, -1)).toBeUndefined();
    expect(washStep([], null, 1)).toBeUndefined();
  });

  it("refuses to step from a block it does not have", () => {
    expect(washStep(blocks, 99, -1)).toBeUndefined();
  });
});

describe("personColor", () => {
  const people = [{ color: "#22d3ee", id: "addie", label: "Addie" }];

  it("uses the configured person's colour, and the neutral when unassigned", () => {
    expect(personColor(people, "addie")).toBe("#22d3ee");
    expect(personColor(people, null)).toContain("--cyber-line");
    expect(personColor(people, "nobody")).toContain("--cyber-line");
  });
});
