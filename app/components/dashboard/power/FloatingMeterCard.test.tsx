import { fireEvent, render, screen } from "@testing-library/react";
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
