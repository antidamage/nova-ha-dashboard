import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dateKeysBetween,
  enrichExistingRecords,
  extractAccountMetadata,
  extractIntervalsForDate,
  findAccountContext,
  summarizeRangeResults,
} from "./powershop-daily-scrape.mjs";

function response(operationName, body) {
  return {
    body,
    url: `https://api.powershop.nz/v1/graphql/?opName=${operationName}`,
  };
}

describe("Powershop account discovery", () => {
  it("uses the selected account from accountsList without accountViewer", () => {
    const captured = [
      response("accountsList", {
        data: {
          viewer: {
            accounts: [
              { number: "first", properties: [{ id: "property-first" }] },
              { number: "selected", properties: [{ id: "property-selected" }] },
            ],
          },
        },
      }),
    ];

    expect(findAccountContext(captured, "selected")).toEqual({
      accountNumber: "selected",
      propertyId: "property-selected",
    });
  });

  it("falls back to the standalone account response", () => {
    const captured = [
      response("account", {
        data: {
          account: { number: "account", properties: [{ id: "property" }] },
        },
      }),
    ];

    expect(findAccountContext(captured, null)).toEqual({
      accountNumber: "account",
      propertyId: "property",
    });
  });

  it("ignores responses without both an account number and property id", () => {
    const captured = [
      response("measurementsAllProperties", {
        data: { account: { id: "opaque-account-id", properties: [{ id: "property" }] } },
      }),
    ];

    expect(findAccountContext(captured, null)).toBeNull();
  });

  it("skips an incomplete account response before a usable list response", () => {
    const captured = [
      response("measurementsAllProperties", {
        data: { account: { id: "opaque-account-id", properties: [{ id: "property" }] } },
      }),
      response("accountsList", {
        data: { viewer: { accounts: [{ number: "account", properties: [{ id: "usable-property" }] }] } },
      }),
    ];

    expect(findAccountContext(captured, null)).toEqual({
      accountNumber: "account",
      propertyId: "usable-property",
    });
  });
});

describe("Powershop range dates", () => {
  it("includes every calendar day across month boundaries", () => {
    expect(dateKeysBetween("2026-04-29", "2026-05-02")).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });

  it("accepts a single-day range", () => {
    expect(dateKeysBetween("2026-08-14", "2026-08-14")).toEqual(["2026-08-14"]);
  });

  it("rejects invalid or reversed ranges", () => {
    expect(() => dateKeysBetween("2026-02-30", "2026-03-01")).toThrow(/Invalid Powershop date range/);
    expect(() => dateKeysBetween("2026-05-02", "2026-05-01")).toThrow(/after end date/);
  });
});

describe("Powershop range results", () => {
  it("treats partial records as an incomplete range", () => {
    expect(summarizeRangeResults([
      { status: "ok", targetDate: "2026-08-13" },
      { status: "partial", targetDate: "2026-08-14" },
    ], [], "2026-08-13", "2026-08-14", 2)).toMatchObject({
      failed: 0,
      partial: 1,
      partialDates: ["2026-08-14"],
      status: "range_partial",
    });
  });

  it("reports a complete all-ok range", () => {
    expect(summarizeRangeResults([
      { status: "ok", targetDate: "2026-08-13" },
      { status: "ok", targetDate: "2026-08-14" },
    ], [], "2026-08-13", "2026-08-14", 2)).toMatchObject({
      completed: 2,
      partial: 0,
      status: "range_ok",
    });
  });
});

describe("Powershop calibration evidence", () => {
  const measurements = response("measurements", {
    data: {
      account: {
        property: {
          measurements: {
            edges: [
              {
                node: {
                  endAt: "2026-08-14T01:00:00+12:00",
                  metaData: {
                    statistics: [
                      { type: "CONSUMPTION_COST", costInclTax: { estimatedAmount: "18.42" } },
                      { type: "STANDING_CHARGE_COST", costInclTax: { estimatedAmount: "12.94" } },
                    ],
                  },
                  startAt: "2026-08-14T00:00:00+12:00",
                  unit: "kwh",
                  value: "0.7",
                },
              },
              {
                node: {
                  endAt: "2026-08-15T01:00:00+12:00",
                  metaData: { statistics: [] },
                  startAt: "2026-08-15T00:00:00+12:00",
                  unit: "kwh",
                  value: "9",
                },
              },
            ],
          },
        },
      },
    },
  });
  const billing = response("billingPeriods", {
    data: {
      account: {
        billingOptions: {
          currentBillingPeriodEndDate: "2026-08-16",
          currentBillingPeriodStartDate: "2026-07-17",
          isFixed: true,
          nextBillingDate: "2026-08-17",
          periodStartDay: 17,
        },
      },
    },
  });

  it("promotes hourly usage and split charge components from GraphQL evidence", () => {
    expect(extractIntervalsForDate([measurements], "2026-08-14")).toEqual([
      {
        costNzd: 0.3136,
        endAt: "2026-08-14T01:00:00+12:00",
        kwh: 0.7,
        standingCostNzd: 0.1294,
        startAt: "2026-08-14T00:00:00+12:00",
        usageCostNzd: 0.1842,
      },
    ]);
  });

  it("extracts the authoritative current Powershop billing window", () => {
    expect(extractAccountMetadata([billing])?.billing).toEqual({
      currentPeriodEndDate: "2026-08-16",
      currentPeriodStartDate: "2026-07-17",
      isFixed: true,
      nextBillingDate: "2026-08-17",
      periodStartDay: 17,
    });
  });

  it("enriches existing daily files from retained raw evidence without logging in", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "powershop-enrich-"));
    await mkdir(path.join(dir, "daily"), { recursive: true });
    await mkdir(path.join(dir, "raw"), { recursive: true });
    await writeFile(
      path.join(dir, "daily", "2026-08-14.json"),
      JSON.stringify({
        capturedAt: "2026-08-15T00:00:00Z",
        rawEvidencePath: "/data/raw/2026-08-14-1.json",
        schemaVersion: 1,
        source: "powershop",
        status: "ok",
        targetDate: "2026-08-14",
        values: { costNzd: 0.31, kwh: 0.7 },
      }),
    );
    await writeFile(
      path.join(dir, "raw", "2026-08-14-1.json"),
      JSON.stringify({ responses: [measurements, billing], targetDate: "2026-08-14" }),
    );

    const result = await enrichExistingRecords(dir, {
      output: { dailyDirectory: "daily", latestFile: "latest.json", rawDirectory: "raw" },
    });
    const enriched = JSON.parse(await readFile(path.join(dir, "daily", "2026-08-14.json"), "utf8"));
    const account = JSON.parse(await readFile(path.join(dir, "account.json"), "utf8"));

    expect(result).toMatchObject({ accountMetadata: true, enriched: 1, total: 1 });
    expect(enriched).toMatchObject({ schemaVersion: 2, intervals: [{ kwh: 0.7 }] });
    expect(account.billing.currentPeriodStartDate).toBe("2026-07-17");
  });
});
