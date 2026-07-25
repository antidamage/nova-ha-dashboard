import { describe, expect, it } from "vitest";
import { definedSha, isUpdaterBusyState } from "./update";

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

describe("definedSha", () => {
  // The updater writes "currentSha": "" before it has ever deployed anything.
  // An empty string is not nullish, so `state?.currentSha ?? fallbackSha()`
  // accepted it as a real value: the fallback was never consulted and
  // updateAvailable -- which requires a truthy currentSha -- was pinned to
  // false. The dashboard reported "Already up to date ()" for eight days while
  // running an unknown version, and no update could be offered or applied.
  it("treats a blank sha as absent so the fallback is consulted", () => {
    expect(definedSha("")).toBeNull();
    expect(definedSha("   ")).toBeNull();
    expect(definedSha(undefined)).toBeNull();
    expect(definedSha(null)).toBeNull();
  });

  it("keeps a real sha, trimmed", () => {
    expect(definedSha("ae8279f")).toBe("ae8279f");
    expect(definedSha(" ae8279f\n")).toBe("ae8279f");
  });

  it("composes with ?? so an empty state sha falls through", () => {
    const fromState = "";
    const fromEnv = "51cb687";
    expect(definedSha(fromState) ?? fromEnv).toBe("51cb687");
    // Regression guard: the original expression did the opposite.
    expect((fromState as string | null) ?? fromEnv).toBe("");
  });
});
