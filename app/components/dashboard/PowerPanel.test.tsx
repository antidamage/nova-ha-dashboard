import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PowerDashboard } from "../../../lib/power";
import { PowerPanel } from "./PowerPanel";

const data = {
  accountRateGraph: [{ cPerKwh: 30, label: "May 2026" }],
  accountUsageGraph: [{ costNzd: 90, kwh: 300, label: "May 2026", source: "Powershop daily scrape" }],
  backgroundEstimateGraph: [
    {
      computerKwh: 40,
      fridgeKwh: 30,
      label: "May 2026",
      novaKwh: 20,
      otherKwh: 180,
      totalKwh: 300,
      waterHeaterKwh: 30,
    },
  ],
  baseLoad: { costPerDayNzd: 2, kwhPerDay: 6 },
  billingCycle: { day: 1, days: 30, endDate: "2026-08-18", label: "Aug 2026", startDate: "2026-07-19" },
  currentRate: { cPerKwh: 30, dailyCents: 100, displayName: "Anytime", period: "anytime", sourceUrl: "https://example.com" },
  currentWatts: 500,
  devices: [],
  generatedAt: "2026-08-15T00:00:00.000Z",
  graph: [],
  rateGraph: [],
  summaries: {
    day: { costNzd: 1, kwh: 2, projectedCostNzd: 3, projectedKwh: 4 },
    month: { costNzd: 10, kwh: 20, projectedCostNzd: 30, projectedKwh: 40 },
    week: { costNzd: 5, kwh: 10, projectedCostNzd: 15, projectedKwh: 20 },
    yearToDate: { costNzd: 100, kwh: 200, projectedCostNzd: 300, projectedKwh: 400 },
  },
} as unknown as PowerDashboard;

vi.mock("./usePowerDashboard", () => ({
  usePowerDashboard: () => ({ data, error: null }),
}));

vi.mock("../AgentNameContext", () => ({
  useAgentName: () => ({ agentName: "Nova" }),
}));

describe("PowerPanel inferred base loads", () => {
  it("starts collapsed and reveals the refreshed billing-cycle estimate on request", () => {
    render(<PowerPanel />);

    const toggle = screen.getByRole("button", { name: /inferred base loads/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("May '26")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("May '26")).toBeInTheDocument();
    expect(screen.getByTitle("Unattributed usage")).toHaveTextContent("O 180");
  });
});
