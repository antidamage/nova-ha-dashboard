import { describe, expect, it } from "vitest";
import { isUpdaterBusyState } from "./update";

describe("isUpdaterBusyState", () => {
  it("reports busy for an in-progress phase with a fresh timestamp", () => {
    expect(isUpdaterBusyState({
      schema: 1,
      phase: "building",
      phaseAt: new Date().toISOString(),
    })).toBe(true);
  });

  it("treats a long-stuck busy phase as a dead updater, not busy", () => {
    expect(isUpdaterBusyState({
      schema: 1,
      phase: "building",
      phaseAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    })).toBe(false);
  });

  it("stays busy when the timestamp is missing or unparseable", () => {
    expect(isUpdaterBusyState({ schema: 1, phase: "restarting" })).toBe(true);
  });

  it("is not busy for terminal phases or missing state", () => {
    expect(isUpdaterBusyState({ schema: 1, phase: "success", phaseAt: new Date().toISOString() })).toBe(false);
    expect(isUpdaterBusyState({ schema: 1, phase: "failed", phaseAt: new Date().toISOString() })).toBe(false);
    expect(isUpdaterBusyState(null)).toBe(false);
  });
});
