import { describe, expect, it } from "vitest";
import type { WashBlock, WashGraphCycle } from "../../../../../lib/power";
import { personColor, washLabelPlacement, washPlacement, washStep } from "./wash-timeline";

/**
 * The graph's own maths (specs/power-meters.md §5.2): where a wash sits across the
 * day on show, where its start-and-duration label goes underneath it, and where a
 * step lands. The days it steps through hold a wash by construction, which is what
 * makes a step skip the days that hold none.
 */

/** One local day: midnight to midnight, 24 hours across. */
const BLOCK: WashBlock = {
  dateLabel: "Sat 19 Sep 2026",
  endMs: Date.parse("2026-09-19T12:00:00.000Z"),
  startMs: Date.parse("2026-09-18T12:00:00.000Z"),
};

const HOUR = 3_600_000;
const wash = (startHours: number, endHours: number) =>
  ({
    endedAt: new Date(BLOCK.startMs + endHours * HOUR).toISOString(),
    startedAt: new Date(BLOCK.startMs + startHours * HOUR).toISOString(),
  }) as WashGraphCycle;

describe("washPlacement", () => {
  it("places a wash across the day by its own clock time", () => {
    expect(washPlacement(wash(3, 9), BLOCK)).toEqual({ left: 12.5, width: 25 });
  });

  it("anchors a wash that started before the day at its first hour, keeping its duration as its width", () => {
    // 11:00 PM to 5:00 AM local: six hours of wash, drawn from midnight.
    expect(washPlacement(wash(-1, 5), BLOCK)).toEqual({ left: 0, width: 25 });
  });

  it("keeps a late wash's touch width inside the day", () => {
    const { left, width } = washPlacement(wash(23.5, 23.83), BLOCK);
    expect(width).toBe(14);
    expect(left + width).toBe(100);
  });

  it("gives a short wash the width of a touch target", () => {
    expect(washPlacement(wash(0, 0.2), BLOCK).width).toBe(14);
  });
});

describe("washLabelPlacement", () => {
  it("centres a label under its own block, on one row", () => {
    const { labels, rows } = washLabelPlacement([wash(6, 18)], BLOCK);

    expect(rows).toBe(1);
    expect(labels).toEqual([{ across: 50, cycle: expect.anything(), row: 0 }]);
  });

  it("keeps a label at either edge inside the graph", () => {
    const early = washLabelPlacement([wash(0, 2)], BLOCK);
    const late = washLabelPlacement([wash(22, 24)], BLOCK);

    // Half a label's width in from each edge, so neither hangs off the box.
    expect(early.labels[0].across).toBe(19);
    expect(late.labels[0].across).toBe(81);
  });

  it("gives a label the next row down when it would draw over the one before it", () => {
    // Two loads an hour and a half apart, which is what this household's own day
    // looks like: both blocks start inside the first fifth of the day.
    const { labels, rows } = washLabelPlacement([wash(0, 1), wash(1.5, 2.5)], BLOCK);

    expect(rows).toBe(2);
    expect(labels.map((label) => label.row)).toEqual([0, 1]);
  });

  it("reuses a row once the label on it is clear again", () => {
    const { labels, rows } = washLabelPlacement([wash(0, 1), wash(1.5, 2.5), wash(20, 21)], BLOCK);

    expect(rows).toBe(2);
    expect(labels.map((label) => label.row)).toEqual([0, 1, 0]);
  });

  it("still reserves one row with no washes at all, so the graph does not move", () => {
    expect(washLabelPlacement([], BLOCK)).toEqual({ labels: [], rows: 1 });
  });
});

describe("washStep", () => {
  const blocks = [30, 10, 20, 20];

  it("steps back from the newest day to the one before it, skipping the empty ones", () => {
    expect(washStep(blocks, null, -1)).toBe(20);
  });

  it("holds the newest day as the follow state, which is never a block number", () => {
    expect(washStep(blocks, 20, 1)).toBeNull();
  });

  it("steps either way between the days it has", () => {
    expect(washStep(blocks, 20, -1)).toBe(10);
    expect(washStep(blocks, 10, 1)).toBe(20);
  });

  it("has nowhere to go at either end", () => {
    expect(washStep(blocks, 10, -1)).toBeUndefined();
    expect(washStep(blocks, null, 1)).toBeUndefined();
  });

  it("has nowhere to go with no days at all", () => {
    expect(washStep([], null, -1)).toBeUndefined();
    expect(washStep([], null, 1)).toBeUndefined();
  });

  it("refuses to step from a day it does not have", () => {
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
