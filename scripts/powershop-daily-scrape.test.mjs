import { describe, expect, it } from "vitest";
import { findAccountContext } from "./powershop-daily-scrape.mjs";

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
