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
 * The amp's "Auto On" and "Auto Off" switches (specs/amp-appletv-power.md §7):
 * which directions this automation may move the amp in, drawn under the amp's
 * own reading.
 */
describe("FloatingMeterCard — Auto On and Auto Off", () => {
  const withAmpControl = (autoOn: boolean, autoOff: boolean) =>
    ({
      ...summary,
      ampControl: { autoOff, autoOn, categoryId: "amp" },
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

  const postedBody = () => {
    const calls = (fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls;
    return JSON.parse(calls[calls.length - 1][1].body);
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws both switches, under the amp's reading and no other row's", () => {
    render(<FloatingMeterCard summary={withAmpControl(true, false)} />);

    const autoOn = screen.getByLabelText("Auto On");
    const autoOff = screen.getByLabelText("Auto Off");
    expect(rowOf("Amp")?.contains(autoOn)).toBe(true);
    expect(rowOf("Amp")?.contains(autoOff)).toBe(true);
    expect(rowOf("Home Entertainment")?.contains(autoOn)).toBe(false);
    expect(screen.getAllByLabelText("Auto On")).toHaveLength(1);
    expect(screen.getAllByLabelText("Auto Off")).toHaveLength(1);
    // The single switch these replaced is gone.
    expect(screen.queryByText("Automate state")).toBeNull();
  });

  it("draws nothing when this household has no amp controller", () => {
    render(<FloatingMeterCard summary={summary} />);

    expect(screen.queryByLabelText("Auto On")).toBeNull();
    expect(screen.queryByLabelText("Auto Off")).toBeNull();
  });

  it("shows the pair the server reports", () => {
    render(<FloatingMeterCard summary={withAmpControl(false, true)} />);

    expect((screen.getByLabelText("Auto On") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Auto Off") as HTMLInputElement).checked).toBe(true);
  });

  it("sends both switches when one is tapped", async () => {
    render(<FloatingMeterCard summary={withAmpControl(true, true)} />);
    fireEvent.click(screen.getByLabelText("Auto Off"));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/power/amp-automation", expect.objectContaining({ method: "POST" })),
    );
    // One POST, both values: the untouched direction is sent as it stands.
    expect(postedBody()).toEqual({ autoOff: false, autoOn: true });
  });

  it("takes both truth back when the write fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<FloatingMeterCard summary={withAmpControl(true, true)} />);
    fireEvent.click(screen.getByLabelText("Auto Off"));

    await vi.waitFor(() =>
      expect((screen.getByLabelText("Auto Off") as HTMLInputElement).checked).toBe(true),
    );
    expect((screen.getByLabelText("Auto On") as HTMLInputElement).checked).toBe(true);
  });

  it("does not let a slow failure undo a newer tap", async () => {
    const settle: Array<(value: unknown) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => settle.push(resolve))));
    render(<FloatingMeterCard summary={withAmpControl(true, true)} />);

    fireEvent.click(screen.getByLabelText("Auto Off"));
    fireEvent.click(screen.getByLabelText("Auto On"));
    // The first write fails after the second was made: the household's latest
    // tap stands rather than being snapped back to the server's old pair.
    settle[0]({ ok: false, json: async () => ({}) });
    settle[1]({ ok: true, json: async () => ({}) });

    await vi.waitFor(() =>
      expect((screen.getByLabelText("Auto On") as HTMLInputElement).checked).toBe(false),
    );
    expect((screen.getByLabelText("Auto Off") as HTMLInputElement).checked).toBe(false);
  });
});
