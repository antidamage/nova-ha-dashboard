import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PowerWashingMachineSummary, WashHistory } from "../../../../../lib/power";
import { WashingMachineCard } from "./WashingMachineCard";

/**
 * What the panel shows the moment a wash is tapped (specs/power-meters.md 4.3).
 *
 * The optimistic value has to be the one the server will write, because it is
 * what the *next* tap starts from: the tap sends the cycle id only and the server
 * owns the order, so a panel that walks its own stale copy lands the household a
 * person away from the store and keeps showing it until the day is re-read.
 *
 * The case that matters is a block the unclaimed default picked up: one tap
 * claims it for the first configured person, and a second tap — inside the ten
 * seconds before the graph re-reads, when the block still carries the old
 * `source: "auto"` — walks on from the claim just made, not from the default.
 */

const DAY = Date.parse("2026-09-18T00:00:00.000Z");
const HOUR = 3_600_000;

const HISTORY: WashHistory = {
  blocks: [DAY],
  cycles: [{
    attribution: { at: "2026-09-18T03:00:00.000Z", source: "auto" },
    costNzd: 0.12, curve: [90, 380, 210, 0], durationLabel: "1h 30m",
    endedAt: new Date(DAY + 2.5 * HOUR).toISOString(), id: "wash-1", kwh: 0.44,
    person: "tonya", startLabel: "1:00 AM", startedAt: new Date(DAY + HOUR).toISOString(),
  }],
  window: { dateLabel: "Fri 18 Sep 2026", endMs: DAY + 24 * HOUR, startMs: DAY },
};

const summary = {
  cycles: [], monthKey: "2026-09", open: null,
  people: [
    { color: "#22d3ee", id: "addie", label: "Addie", primary: true },
    { color: "#e879f9", id: "tonya", label: "Tonya" },
  ],
  totals: [], watts: null,
} as unknown as PowerWashingMachineSummary;

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: { method?: string }) => (
    init?.method === "POST" ? { json: async () => ({}), ok: true } : { json: async () => HISTORY, ok: true }
  )));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claiming a wash on the panel", () => {
  it("keeps the claim on screen until the block's own read catches up", async () => {
    // The summary is polled every five seconds and the graph every ten. When the
    // summary agrees with a tap before the graph has re-read, the block is still
    // drawing its older copy — dropping the claim then puts the old person back,
    // and the next tap walks on from a value the store does not have.
    stubFetch();
    const { rerender } = render(<WashingMachineCard displayMode="credits" summary={summary} />);
    fireEvent.click(await screen.findByRole("button", { name: /0.44 kWh wash, Tonya \(default\)/ }));
    expect(screen.getByRole("button", { name: /0.44 kWh wash, Addie/ })).toBeTruthy();

    // The summary poll arrives carrying the write the tap made — the read that
    // AGREES with the claim — while the graph, ten seconds behind it, is still
    // drawing the pre-tap copy. Dropping the claim on the summary's word puts
    // Tonya back on screen with no pending to say the block is stale.
    const claimed = { ...HISTORY.cycles[0], attribution: { at: "2026-09-18T03:05:00.000Z", source: "manual" }, person: "addie" };
    rerender(<WashingMachineCard displayMode="credits"
      summary={{ ...summary, cycles: [claimed] } as unknown as PowerWashingMachineSummary} />);

    // Still the claim — not the stale block underneath it.
    fireEvent.click(screen.getByRole("button", { name: /0.44 kWh wash, Addie/ }));
    expect(screen.getByRole("button", { name: /0.44 kWh wash, Tonya/ })).toBeTruthy();
  });

  it("walks on from the value it is showing, so it never disagrees with the server", async () => {
    stubFetch();
    render(<WashingMachineCard displayMode="credits" summary={summary} />);

    // The default picked this wash up: hatched, and named as a default.
    const asDefault = await screen.findByRole("button", { name: /0.44 kWh wash, Tonya \(default\)/ });
    fireEvent.click(asDefault);

    // One tap claims it for the first configured person — not for the next one
    // along from Tonya, which would have read as the wash being released.
    const claimed = screen.getByRole("button", { name: /0.44 kWh wash, Addie/ });
    expect(claimed.getAttribute("aria-label")).not.toContain("default");
    fireEvent.click(claimed);

    // Still before the graph's next read, and the block still says `auto`. The
    // server has Addie now, so this tap is Tonya's — and the panel must say so.
    expect(screen.getByRole("button", { name: /0.44 kWh wash, Tonya/ })).toBeTruthy();
  });
});
