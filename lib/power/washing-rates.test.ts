import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The plan the washing machine is costed at (specs/power-meters.md §4.1).
 *
 * Two facts are load-bearing and both are pinned here: a window is anchored on
 * the local day it OPENS, so a `21:00`-`07:00` half-price night is still that
 * evening's window at 2 AM; and a household with no plan of its own for the
 * machine falls back to its own tariff rather than to zero.
 *
 * `Pacific/Auckland` is UTC+12 through these fixtures (NZDT starts 2026-09-27),
 * so `2026-09-23T21:30:00Z` is 09:30 on the 24th locally.
 */

const MIDDAY_WEDNESDAY = new Date("2026-09-23T00:00:00.000Z"); // 12:00 Wed, local
const LATE_WEDNESDAY = new Date("2026-09-23T10:00:00.000Z"); // 22:00 Wed, local
const EARLY_THURSDAY = new Date("2026-09-23T14:00:00.000Z"); // 02:00 Thu, local
const MIDDAY_SUNDAY = new Date("2026-09-27T00:00:00.000Z"); // 12:00 Sun, local

const TARIFF = {
  anytimeCPerKwh: Array.from({ length: 12 }, () => 26),
  dailyCents: 313,
  offPeakCPerKwh: Array.from({ length: 12 }, () => 24),
  peakCPerKwh: Array.from({ length: 12 }, () => 28),
  planName: "The household's own plan",
};

const NIGHT_WINDOW = {
  cPerKwh: 16.1,
  days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  fromMinute: 21 * 60,
  label: "Half price 9pm-7am",
  toMinute: 7 * 60,
};

/** A household config whose wash rates are whatever the case needs. */
function household(rates: unknown) {
  return {
    dashboard: { people: [{ color: "#22d3ee", id: "addie", label: "Addie", primary: true }] },
    power: {
      rates: { tariff: TARIFF },
      timeZone: "Pacific/Auckland",
      washingMachine: {
        entityIds: ["switch.washing_machine"],
        powerSensorEntityId: "sensor.washing_machine_power",
        ...(rates === undefined ? {} : { rates }),
      },
    },
  };
}

const scratchDirs: string[] = [];

async function load(rates: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-wash-rate-"));
  scratchDirs.push(dir);
  const config = path.join(dir, "dashboard-config.json");
  const data = path.join(dir, "power");
  mkdirSync(path.join(data, "washing-machine-traces"), { recursive: true });
  writeFileSync(config, JSON.stringify(household(rates)), "utf8");
  vi.resetModules();
  vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", config);
  vi.stubEnv("NOVA_DASHBOARD_POWER_DATA", data);
  return import("./washing-rates");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { force: true, recursive: true });
});

describe("the wash's own plan", () => {
  it("charges the plan's rate outside every window", async () => {
    const { washRateAt } = await load({ cPerKwh: 28.279, planName: "Contact Energy Basic", windows: [NIGHT_WINDOW] });

    const rate = washRateAt(MIDDAY_WEDNESDAY);

    expect(rate.cPerKwh).toBeCloseTo(28.279, 3);
    expect(rate.planName).toBe("Contact Energy Basic");
    expect(rate.windowLabel).toBeNull();
  });

  it("charges a window's rate inside it, including after midnight", async () => {
    const { washRateAt } = await load({ cPerKwh: 28.279, planName: "Contact Energy Good Charge", windows: [NIGHT_WINDOW] });

    // Wednesday 10 PM: the evening the window opened on.
    expect(washRateAt(LATE_WEDNESDAY).cPerKwh).toBeCloseTo(16.1, 3);
    expect(washRateAt(LATE_WEDNESDAY).windowLabel).toBe("Half price 9pm-7am");
    // Thursday 2 AM: still Wednesday evening's window, because a window's day
    // list names the days it OPENS on.
    expect(washRateAt(EARLY_THURSDAY).cPerKwh).toBeCloseTo(16.1, 3);
  });

  it("keeps a window on its own days only", async () => {
    const { washRateAt } = await load({
      cPerKwh: 28.279,
      planName: "Contact Energy Good Nights",
      windows: [{ ...NIGHT_WINDOW, cPerKwh: 0, days: ["mon", "tue", "wed", "thu", "fri"], label: "Free 9pm-midnight, Mon-Fri", toMinute: 24 * 60 }],
    });

    // Monday 10 PM local: free. Sunday noon: the plan's own rate.
    expect(washRateAt(new Date("2026-09-21T10:00:00.000Z")).cPerKwh).toBe(0);
    expect(washRateAt(MIDDAY_SUNDAY).cPerKwh).toBeCloseTo(28.279, 3);
    expect(washRateAt(MIDDAY_SUNDAY).windowLabel).toBeNull();
  });

  it("matches nothing for a window with no width", async () => {
    const { washRateAt } = await load({
      cPerKwh: 28.279,
      planName: "Contact Energy Basic",
      windows: [{ ...NIGHT_WINDOW, fromMinute: 600, toMinute: 600 }],
    });

    expect(washRateAt(MIDDAY_WEDNESDAY).cPerKwh).toBeCloseTo(28.279, 3);
  });
});

describe("a household with no plan of its own for the machine", () => {
  it("costs the wash at the household's tariff", async () => {
    const { washRateAt } = await load(undefined);

    const rate = washRateAt(MIDDAY_WEDNESDAY);

    expect(rate.cPerKwh).toBe(26);
    expect(rate.planName).toBe("The household's own plan");
    expect(rate.windowLabel).toBeNull();
  });
});
