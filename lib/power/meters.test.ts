import { describe, expect, it } from "vitest";
import type { PowerState } from "./types";
import { ampAutomation } from "./meters";

/**
 * The amp's two switches, and the single one they replaced
 * (specs/amp-appletv-power.md §7): `automationEnabled` said one thing about
 * both directions, so it is read as what it meant rather than ignored.
 */
describe("ampAutomation", () => {
  /** What the file can hold: a legacy switch, a partial pair, or nothing. */
  const state = (ampPowerControl: unknown): PowerState =>
    ({ ampPowerControl }) as unknown as PowerState;

  it("is both directions on when nothing is stored", () => {
    expect(ampAutomation(undefined)).toEqual({ autoOff: true, autoOn: true });
    expect(ampAutomation(state(undefined))).toEqual({ autoOff: true, autoOn: true });
  });

  it("reads the legacy switch as one answer for both directions", () => {
    expect(ampAutomation(state({ automationEnabled: true, updatedAt: "x" }))).toEqual({
      autoOff: true,
      autoOn: true,
    });
    expect(ampAutomation(state({ automationEnabled: false, updatedAt: "x" }))).toEqual({
      autoOff: false,
      autoOn: false,
    });
  });

  it("prefers stored directions over the legacy switch", () => {
    expect(
      ampAutomation(
        state({ autoOff: false, autoOn: true, automationEnabled: false, updatedAt: "x" }),
      ),
    ).toEqual({ autoOff: false, autoOn: true });
  });

  it("fills in whichever direction is missing", () => {
    // A file written between the two builds: one direction stored explicitly.
    expect(ampAutomation(state({ autoOn: false, updatedAt: "x" }))).toEqual({
      autoOff: true,
      autoOn: false,
    });
  });

  it("ignores a direction that is not a boolean", () => {
    // A hand-edited file: "false" is truthy, so it must not count as a value —
    // the legacy answer (or on) applies instead.
    expect(ampAutomation(state({ autoOff: "false", autoOn: false, updatedAt: "x" }))).toEqual({
      autoOff: true,
      autoOn: false,
    });
    expect(
      ampAutomation(state({ autoOff: 0, autoOn: "no", automationEnabled: false, updatedAt: "x" })),
    ).toEqual({ autoOff: false, autoOn: false });
  });
});
