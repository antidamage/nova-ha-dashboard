import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerFloatingMeterSummary } from "../../../../lib/power";
import { FloatingMeterCard } from "./FloatingMeterCard";

/**
 * Moving the meter is confirmed, never optimistic (specs/amp-appletv-power.md §6).
 * The category is server state describing where a physical plug is, and a mis-tap
 * onto Amp hands the Apple TV authority over a plug feeding something else.
 */

const summary = {
  activeCategoryId: "home_entertainment",
  watts: 57.2,
  categories: [
    {
      id: "home_entertainment",
      label: "Home Entertainment",
      icon: "entertainment",
      watts: 57.2,
      confidence: "measured",
      measuredHours: 30,
      members: ["TV", "Nova kiosk"],
    },
    {
      id: "amp",
      label: "Amp",
      icon: "amp",
      watts: 120,
      confidence: "assumed",
      measuredHours: 0,
      members: ["Amp", "Sub + amp"],
    },
  ],
} as unknown as PowerFloatingMeterSummary;

function openTheMenuAndChooseAmp() {
  fireEvent.click(screen.getByLabelText("What the floating meter is measuring"));
  fireEvent.click(screen.getByRole("button", { name: /Amp/ }));
}

describe("FloatingMeterCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks before moving the meter, and names both ends", () => {
    render(<FloatingMeterCard summary={summary} />);
    openTheMenuAndChooseAmp();

    expect(screen.getByText("Move the floating meter?")).toBeTruthy();
    expect(screen.getByText(/measuring Home Entertainment/)).toBeTruthy();
    expect(screen.getByText(/Moving it to Amp/)).toBeTruthy();
    expect(screen.getByText(/physically moved the plug/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends nothing when the move is cancelled", () => {
    render(<FloatingMeterCard summary={summary} />);
    openTheMenuAndChooseAmp();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Move the floating meter?")).toBeNull();
  });

  it("moves the meter once it is confirmed", () => {
    render(<FloatingMeterCard summary={summary} />);
    openTheMenuAndChooseAmp();
    fireEvent.click(screen.getByRole("button", { name: "Move the meter" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/power/floating-meter",
      expect.objectContaining({ body: JSON.stringify({ categoryId: "amp" }), method: "POST" }),
    );
  });

  it("does not ask about the category that is already active", () => {
    render(<FloatingMeterCard summary={summary} />);
    fireEvent.click(screen.getByLabelText("What the floating meter is measuring"));
    fireEvent.click(screen.getByRole("button", { name: /Home Entertainment/ }));

    expect(screen.queryByText("Move the floating meter?")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * The amp's "Automate state" switch (specs/amp-appletv-power.md §7): whether
 * the amp follows the Apple TV at all, drawn under the amp's own reading.
 */
describe("FloatingMeterCard — Automate state", () => {
  const withAmpControl = (enabled: boolean) =>
    ({
      ...summary,
      ampControl: { categoryId: "amp", enabled },
    }) as unknown as PowerFloatingMeterSummary;

  // Scoped to a row: the category label also appears in the dropdown's trigger,
  // so a bare text query matches twice.
  const rowOf = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(".power-meter-row")).find((row) => {
      try {
        return Boolean(within(row).getByText(label));
      } catch {
        return false;
      }
    });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws one switch, under the amp's reading and no other row's", () => {
    render(<FloatingMeterCard summary={withAmpControl(true)} />);

    const box = screen.getByLabelText("Automate state");
    expect(rowOf("Amp")?.contains(box)).toBe(true);
    expect(rowOf("Home Entertainment")?.contains(box)).toBe(false);
    expect(screen.getAllByLabelText("Automate state")).toHaveLength(1);
  });

  it("draws nothing when this household has no amp controller", () => {
    render(<FloatingMeterCard summary={summary} />);

    expect(screen.queryByLabelText("Automate state")).toBeNull();
  });

  it("shows the switch the server reports", () => {
    render(<FloatingMeterCard summary={withAmpControl(false)} />);

    expect((screen.getByLabelText("Automate state") as HTMLInputElement).checked).toBe(false);
  });

  it("sends the switch to the server when it is tapped", async () => {
    render(<FloatingMeterCard summary={withAmpControl(true)} />);
    fireEvent.click(screen.getByLabelText("Automate state"));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/power/amp-automation",
        expect.objectContaining({ body: JSON.stringify({ enabled: false }), method: "POST" }),
      ),
    );
  });

  it("takes the truth back when the write fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<FloatingMeterCard summary={withAmpControl(true)} />);
    fireEvent.click(screen.getByLabelText("Automate state"));

    await vi.waitFor(() =>
      expect((screen.getByLabelText("Automate state") as HTMLInputElement).checked).toBe(true),
    );
  });
});
