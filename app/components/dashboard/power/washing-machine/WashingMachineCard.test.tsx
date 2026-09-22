import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerWashingMachineSummary, WashBlock, WashGraphCycle, WashHistory } from "../../../../../lib/power";
import { WashingMachineCard } from "./WashingMachineCard";

/**
 * The wash graph steps back through 12-hour blocks, skipping the ones with no
 * data in them, and labels the block on show with its own date and start/end
 * times (specs/power-meters.md §5.2). Every block here is one the store holds a
 * wash in; a block the household did not wash in is absent from `blocks`, which
 * is why a single press lands two blocks back.
 */

const HOUR = 3_600_000;
const OLD = Date.parse("2026-09-17T12:00:00.000Z");
const NEWEST = Date.parse("2026-09-19T00:00:00.000Z");

/** Oldest first, and with no block between them: 18 Sep is a day off. */
const BLOCKS = [OLD, NEWEST];

const block = (startMs: number, dateLabel: string, startLabel: string, endLabel: string): WashBlock => ({
  dateLabel,
  endLabel,
  endMs: startMs + 12 * HOUR,
  startLabel,
  startMs,
});

const wash = (startMs: number, kwh: number, person: string | null): WashGraphCycle => ({
  attribution: { at: "2026-09-19T01:00:00.000Z", source: "manual" },
  costNzd: kwh * 0.28,
  curve: [90, 380, 210, 0],
  endedAt: new Date(startMs + 1.5 * HOUR).toISOString(),
  id: `${startMs}`,
  kwh,
  person,
  startedAt: new Date(startMs).toISOString(),
});

const HISTORY: Record<string, WashHistory> = {
  newest: {
    blocks: BLOCKS,
    cycles: [wash(NEWEST + 2 * HOUR, 0.62, "addie")],
    window: block(NEWEST, "Sat 19 Sep 2026", "12:00 PM", "12:00 AM"),
  },
  oldest: {
    blocks: BLOCKS,
    cycles: [wash(OLD + 1 * HOUR, 0.09, "addie")],
    window: block(OLD, "Thu 17 Sep 2026", "12:00 PM", "12:00 AM"),
  },
};

const summary = {
  cycles: [],
  monthKey: "2026-09",
  open: null,
  people: [
    { color: "#22d3ee", id: "addie", label: "Addie", primary: true },
    { color: "#e879f9", id: "tonya", label: "Tonya" },
  ],
  totals: [],
  watts: null,
} as unknown as PowerWashingMachineSummary;

const requestedBlocks: Array<number | null> = [];

function stubFetch() {
  requestedBlocks.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string }) => {
      if (init?.method === "POST") return { json: async () => ({}), ok: true };
      const url = new URL(String(input), "http://localhost");
      const query = url.searchParams.get("block");
      const wanted = query === null ? "newest" : query === String(OLD) ? "oldest" : "missing";
      requestedBlocks.push(query === null ? null : Number(query));
      return { json: async () => (wanted === "missing" ? {} : HISTORY[wanted]), ok: wanted !== "missing" };
    }),
  );
}

const posted = (index: number) => {
  const calls = (fetch as unknown as { mock: { calls: Array<[string, { body: string; method?: string }]> } }).mock.calls;
  return JSON.parse(calls[index][1].body) as Record<string, unknown>;
};

beforeEach(stubFetch);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WashingMachineCard", () => {
  const open = () => render(<WashingMachineCard displayMode="credits" summary={summary} />);
  const earlier = () => screen.getByRole("button", { name: "Earlier 12-hour block with washes" });
  const later = () => screen.getByRole("button", { name: "Later 12-hour block with washes" });

  it("labels the newest block with its own date and start/end times", async () => {
    open();

    expect(await screen.findByText("Sat 19 Sep 2026")).toBeTruthy();
    expect(screen.getByText("12:00 PM")).toBeTruthy();
    expect(screen.getByText("12:00 AM")).toBeTruthy();
    expect(screen.getByRole("button", { name: /0.62 kWh wash, Addie/ })).toBeTruthy();
  });

  it("cannot step later than the newest block, and can step back from it", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");

    expect((earlier() as HTMLButtonElement).disabled).toBe(false);
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });

  it("steps to the previous block holding a wash, skipping the one between them", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");

    fireEvent.click(earlier());

    expect(await screen.findByText("Thu 17 Sep 2026")).toBeTruthy();
    expect(requestedBlocks).toEqual([null, OLD]);
    expect(screen.getByRole("button", { name: /0.09 kWh wash, Addie/ })).toBeTruthy();
  });

  it("steps forward again to the newest block, which follows the poll", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");
    fireEvent.click(earlier());
    await screen.findByText("Thu 17 Sep 2026");

    fireEvent.click(later());

    expect(await screen.findByText("Sat 19 Sep 2026")).toBeTruthy();
    expect(requestedBlocks.at(-1)).toBeNull();
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });

  it("attributes a wash two blocks back, not just the one being run", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");
    fireEvent.click(earlier());
    await screen.findByText("Thu 17 Sep 2026");

    fireEvent.click(screen.getByRole("button", { name: /0.09 kWh wash, Addie/ }));

    // The tap cycles Addie -> Tonya on the client at once, and posts that wash's id.
    expect(await screen.findByRole("button", { name: /0.09 kWh wash, Tonya/ })).toBeTruthy();
    const post = posted((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length - 1);
    expect(post).toEqual({ cycleId: `${OLD + 1 * HOUR}` });
  });

  it("holds a tap on a wash the polled summary does not carry, until that block's own read echoes it", async () => {
    const { rerender } = open();
    await screen.findByText("Sat 19 Sep 2026");
    fireEvent.click(earlier());
    await screen.findByText("Thu 17 Sep 2026");
    fireEvent.click(screen.getByRole("button", { name: /0.09 kWh wash, Addie/ }));
    expect(await screen.findByRole("button", { name: /0.09 kWh wash, Tonya/ })).toBeTruthy();

    // The dashboard's 5s poll re-renders the card. Its summary carries this
    // calendar month's washes only, so a wash from an earlier month is not in it:
    // the tap must stand rather than being dropped as "not agreed with".
    rerender(<WashingMachineCard displayMode="credits" summary={{ ...summary, cycles: [] } as unknown as PowerWashingMachineSummary} />);
    expect(screen.getByRole("button", { name: /0.09 kWh wash, Tonya/ })).toBeTruthy();
  });

  it("keeps the graph quiet and both buttons dead when there is no history at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          blocks: [],
          cycles: [],
          window: block(Date.now(), "Sat 19 Sep 2026", "12:00 PM", "12:00 AM"),
        }),
        ok: true,
      })),
    );
    open();

    expect(await screen.findByText("No washes in this 12-hour block")).toBeTruthy();
    expect((earlier() as HTMLButtonElement).disabled).toBe(true);
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });
});
