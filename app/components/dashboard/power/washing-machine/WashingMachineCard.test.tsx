import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerWashingMachineSummary, WashBlock, WashGraphCycle, WashHistory } from "../../../../../lib/power";
import { WashingMachineCard } from "./WashingMachineCard";

/**
 * The wash graph steps back through local days, skipping the ones with no data in
 * them, and labels the day on show with its own date — never with the visible
 * range's start and end times, which are the day's own bounds and read as noise on
 * a midnight-to-midnight axis. Each wash carries its own start time and duration,
 * drawn under its block (specs/power-meters.md §5.2). Every day here is one the
 * store holds a wash in; a day the household did not wash in is absent from
 * `blocks`, which is why a single press lands two days back.
 */

const HOUR = 3_600_000;
const OLD = Date.parse("2026-09-16T12:00:00.000Z");
const NEWEST = Date.parse("2026-09-18T12:00:00.000Z");

/** Oldest first, and with no day between them: 18 Sep is a day off. */
const BLOCKS = [OLD, NEWEST];

/** One local day, midnight to midnight. */
const block = (startMs: number, dateLabel: string): WashBlock => ({
  dateLabel,
  endMs: startMs + 24 * HOUR,
  startMs,
});

const wash = (
  startMs: number,
  kwh: number,
  person: string | null,
  startLabel: string,
  durationLabel: string,
): WashGraphCycle => ({
  attribution: { at: "2026-09-19T01:00:00.000Z", source: "manual" },
  costNzd: kwh * 0.28,
  curve: [90, 380, 210, 0],
  durationLabel,
  endedAt: new Date(startMs + 1.5 * HOUR).toISOString(),
  id: `${startMs}`,
  kwh,
  person,
  startLabel,
  startedAt: new Date(startMs).toISOString(),
});

const HISTORY: Record<string, WashHistory> = {
  newest: {
    blocks: BLOCKS,
    // Two loads an hour and a half apart, which is what this household's own days
    // look like: at any card width their labels would draw over each other.
    cycles: [
      wash(NEWEST + 2 * HOUR, 0.62, "addie", "2:00 AM", "1h 30m"),
      wash(NEWEST + 3.5 * HOUR, 0.44, "tonya", "3:30 AM", "45m"),
    ],
    window: block(NEWEST, "Sat 19 Sep 2026"),
  },
  oldest: {
    blocks: BLOCKS,
    cycles: [wash(OLD + 1 * HOUR, 0.09, "addie", "1:00 AM", "1h 30m")],
    window: block(OLD, "Thu 17 Sep 2026"),
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
  const earlier = () => screen.getByRole("button", { name: "Earlier day with washes" });
  const later = () => screen.getByRole("button", { name: "Later day with washes" });

  it("labels the day on show with its own date, not with the range's start and end times", async () => {
    open();

    expect(await screen.findByText("Sat 19 Sep 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: /0.62 kWh wash, Addie/ })).toBeTruthy();
    // The day's own bounds are midnight to midnight, so they are not drawn: only
    // the washes on it say anything about time.
    expect(screen.queryByText("12:00 AM")).toBeNull();
    expect(screen.queryByText("12:00 PM")).toBeNull();
  });

  it("labels each wash under its block with its own start time and duration", async () => {
    open();

    expect(await screen.findByText("2:00 AM · 1h 30m")).toBeTruthy();
    // The button says the same thing for anyone who cannot read the label.
    expect(screen.getByRole("button", { name: /started 2:00 AM, 1h 30m/ })).toBeTruthy();
  });

  it("puts the labels in their own strip under the blocks, on the rows they need", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");

    // The graph reserves a row of its own per label that would otherwise draw over
    // another: two washes an hour and a half apart need two.
    const graph = document.querySelector<HTMLElement>(".power-wash-graph");
    const labels = [...document.querySelectorAll<HTMLElement>(".power-wash-label")];
    expect(graph?.style.getPropertyValue("--wash-label-rows")).toBe("2");
    expect(labels.map((label) => label.textContent)).toEqual(["2:00 AM · 1h 30m", "3:30 AM · 45m"]);
    expect(labels.map((label) => label.style.getPropertyValue("--wash-label-row-index"))).toEqual(["0", "1"]);
    // Under the graph, beside the blocks — never inside the button that claims the
    // wash, whose own background a label would sit on top of.
    expect(labels.every((label) => label.parentElement?.className === "power-wash-labels")).toBe(true);
    expect(document.querySelector(".power-wash-block .power-wash-label")).toBeNull();
  });

  it("cannot step later than the newest day, and can step back from it", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");

    expect((earlier() as HTMLButtonElement).disabled).toBe(false);
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });

  it("steps to the previous day holding a wash, skipping the one between them", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");

    fireEvent.click(earlier());

    expect(await screen.findByText("Thu 17 Sep 2026")).toBeTruthy();
    expect(requestedBlocks).toEqual([null, OLD]);
    expect(screen.getByRole("button", { name: /0.09 kWh wash, Addie/ })).toBeTruthy();
    expect(await screen.findByText("1:00 AM · 1h 30m")).toBeTruthy();
  });

  it("steps forward again to the newest day, which follows the poll", async () => {
    open();
    await screen.findByText("Sat 19 Sep 2026");
    fireEvent.click(earlier());
    await screen.findByText("Thu 17 Sep 2026");

    fireEvent.click(later());

    expect(await screen.findByText("Sat 19 Sep 2026")).toBeTruthy();
    expect(requestedBlocks.at(-1)).toBeNull();
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });

  it("attributes a wash two days back, not just the one being run", async () => {
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

  it("holds a tap on a wash the polled summary does not carry, until that day's own read echoes it", async () => {
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
        json: async () => ({ blocks: [], cycles: [], window: block(Date.now(), "Sat 19 Sep 2026") }),
        ok: true,
      })),
    );
    open();

    expect(await screen.findByText("No washes on this day")).toBeTruthy();
    expect((earlier() as HTMLButtonElement).disabled).toBe(true);
    expect((later() as HTMLButtonElement).disabled).toBe(true);
  });
});
