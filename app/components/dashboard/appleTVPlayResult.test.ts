import { describe, expect, it } from "vitest";
import { readPlayResult } from "./appleTVPlayResult";

describe("the outcome the Apple TV's app reports", () => {
  it("is read as it was sent", () => {
    expect(readPlayResult({ at: "2026-09-22T00:00:00.000Z", id: 2, name: "Excellent", played: true, reason: null }))
      .toEqual({ at: "2026-09-22T00:00:00.000Z", id: 2, name: "Excellent", played: true, reason: null });
  });

  it("keeps the app's own words for a press that played nothing", () => {
    expect(readPlayResult({ at: "x", id: 3, name: "Snake", played: false, reason: "NO PLAYLIST NAMED SNAKE" })?.reason)
      .toBe("NO PLAYLIST NAMED SNAKE");
  });

  it("is nothing at all for anything that is not a report", () => {
    for (const value of [null, undefined, "played", 7, {}, { id: 1, name: "x" }, { id: "1", name: "x", at: "y" }]) {
      expect(readPlayResult(value), JSON.stringify(value)?.slice(0, 40)).toBeNull();
    }
  });

  it("reads anything but a true played as not played", () => {
    for (const played of ["yes", 1, null, undefined]) {
      expect(readPlayResult({ at: "x", id: 1, name: "x", played })?.played, JSON.stringify(played)).toBe(false);
    }
  });

  it("reads a missing or empty reason as no reason", () => {
    expect(readPlayResult({ at: "x", id: 1, name: "x", played: false })?.reason).toBeNull();
    expect(readPlayResult({ at: "x", id: 1, name: "x", played: false, reason: "" })?.reason).toBeNull();
  });
});
