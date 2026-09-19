import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { clampTargetForDisplay } from "../../temperatureEncoderModel";

/**
 * specs/bedroom-heater-control-integrity.md §4 — no preference write without a
 * user gesture. Adeline's bedroom target kept resetting to 19 because the card
 * read its own 18 default before preferences loaded, found it below her floor
 * of 19, and "corrected" it to the server.
 */
describe("a target outside the knob's range", () => {
  it("is displayed clamped without changing the stored value", () => {
    expect(clampTargetForDisplay(18, { min: 19, max: 28 })).toBe(19);
    expect(clampTargetForDisplay(31, { min: 19, max: 28 })).toBe(28);
    expect(clampTargetForDisplay(22, { min: 19, max: 28 })).toBe(22);
    expect(clampTargetForDisplay(null, { min: 19, max: 28 })).toBeNull();
    expect(clampTargetForDisplay(Number.NaN, { min: 19, max: 28 })).toBeNull();
  });

  it("has no hook that sends the clamped value", () => {
    // The hook this replaced took a `send` callback and POSTed on mount. It is
    // gone on purpose: re-adding a mount-time writer reintroduces the bug.
    expect(existsSync(path.join(__dirname, "useClampTargetIntoRange.ts"))).toBe(false);
  });
});

describe("mounting a climate knob", () => {
  it("writes nothing", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    const { HeaterKnob } = await import("./HeaterKnob");
    render(
      <HeaterKnob
        preferences={undefined}
        preferredRange={{ min: 19, max: 28 }}
        switchEntity={{ entity_id: "switch.bedroom_heater", state: "off", attributes: {} } as never}
        temperature={20}
        title="Bedroom"
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const writes = fetchSpy.mock.calls.filter(([, init]) => {
      const method = (init as RequestInit | undefined)?.method;
      return method !== undefined && method.toUpperCase() !== "GET";
    });
    expect(writes).toEqual([]);
    vi.unstubAllGlobals();
  });
});
