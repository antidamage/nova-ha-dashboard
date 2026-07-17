import { describe, expect, it, beforeEach } from "vitest";
import {
  claimLatestLightingCommand,
  INTERACTIVE_LIGHTING_COMMAND_KEY,
  resetLightingCommandCoordinatorForTest,
  SupersededLightingCommandError,
} from "./lighting-command-coordinator";

describe("lighting command coordinator", () => {
  beforeEach(() => {
    resetLightingCommandCoordinatorForTest();
  });

  it("marks older claims for the same command key as superseded", () => {
    const first = claimLatestLightingCommand("zone:lounge");
    const second = claimLatestLightingCommand("zone:lounge");

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(() => first.assertCurrent()).toThrow(SupersededLightingCommandError);
  });

  it("keeps independent command keys current", () => {
    const lounge = claimLatestLightingCommand("zone:lounge");
    const bedroom = claimLatestLightingCommand("zone:bedroom");

    expect(lounge.isCurrent()).toBe(true);
    expect(bedroom.isCurrent()).toBe(true);
  });

  it("can use a shared key to supersede commands across entry points", () => {
    const zone = claimLatestLightingCommand([INTERACTIVE_LIGHTING_COMMAND_KEY, "zone:lounge"]);
    const shortcut = claimLatestLightingCommand([INTERACTIVE_LIGHTING_COMMAND_KEY, "shortcut:all"]);

    expect(zone.isCurrent()).toBe(false);
    expect(shortcut.isCurrent()).toBe(true);
  });

  it("treats an aborted request signal as superseded", () => {
    const controller = new AbortController();
    const claim = claimLatestLightingCommand("entity:light:light.desk", controller.signal);

    controller.abort();

    expect(claim.isCurrent()).toBe(false);
    expect(() => claim.assertCurrent()).toThrow(SupersededLightingCommandError);
  });
});
