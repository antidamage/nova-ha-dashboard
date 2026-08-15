import { describe, expect, it } from "vitest";
import { dateKeysBetween, findAccountContext, summarizeRangeResults } from "./powershop-daily-scrape.mjs";

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
