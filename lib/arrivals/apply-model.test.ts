import { describe, expect, it, vi } from "vitest";
import { applyArrivalStates } from "./apply-model";
import type { ArrivalTarget } from "./types";

function target(apply: ArrivalTarget["apply"]): ArrivalTarget {
  return { kind: "lighting", label: "Lighting", presets: async () => [], apply };
}

describe("applying arrival states", () => {
  it("applies each state in order", async () => {
    const applied: string[] = [];
    const results = await applyArrivalStates(
      [
        { target: "lighting", presetId: "one" },
        { target: "lighting", presetId: "two" },
      ],
      { lighting: target(async (id) => { applied.push(id); }) },
    );

    expect(applied).toEqual(["one", "two"]);
    expect(results).toEqual([
      { target: "lighting", presetId: "one", ok: true },
      { target: "lighting", presetId: "two", ok: true },
    ]);
  });

  it("keeps going after a failure and reports that entry's own error", async () => {
    const apply = vi.fn(async (id: string) => {
      if (id === "gone") throw new Error("Unknown lighting preset: gone");
    });
    const results = await applyArrivalStates(
      [
        { target: "lighting", presetId: "gone" },
        { target: "lighting", presetId: "fine" },
      ],
      { lighting: target(apply) },
    );

    expect(apply).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual({
      target: "lighting",
      presetId: "gone",
      ok: false,
      error: "Unknown lighting preset: gone",
    });
    expect(results[1].ok).toBe(true);
  });

  it("reports an entry whose target kind is not installed", async () => {
    const results = await applyArrivalStates([{ target: "climate", presetId: "off" }], {});

    expect(results).toEqual([
      { target: "climate", presetId: "off", ok: false, error: 'No target is installed for "climate"' },
    ]);
  });
});
