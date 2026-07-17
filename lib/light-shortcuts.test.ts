import { describe, expect, it, beforeEach } from "vitest";
import type { DashboardEntity } from "./types";
import {
  claimLightShortcutCooldown,
  decideLightShortcutAction,
  rememberLightShortcutAction,
  resetLightShortcutCooldownsForTest,
  shortcutLightingEntities,
  shortcutTargetIdsFromEntities,
} from "./light-shortcuts";

function entity(
  entity_id: string,
  state: string,
  options: Partial<Pick<DashboardEntity, "domain" | "isIllumination">> = {},
): DashboardEntity {
  return {
    area_id: "kitchen",
    attributes: {},
    domain: options.domain ?? "light",
    entity_id,
    isIllumination: options.isIllumination,
    name: entity_id,
    state,
  };
}

describe("light shortcut helpers", () => {
  beforeEach(() => {
    resetLightShortcutCooldownsForTest();
  });

  it("turns lights off when most available lighting entities are on", () => {
    const decision = decideLightShortcutAction([
      entity("light.one", "on"),
      entity("light.two", "on"),
      entity("light.three", "off"),
    ]);

    expect(decision).toEqual({ action: "off", offCount: 1, onCount: 2, total: 3 });
  });

  it("turns lights on when most available lighting entities are off or tied", () => {
    expect(decideLightShortcutAction([entity("light.one", "off"), entity("light.two", "on")]).action).toBe("on");
    expect(decideLightShortcutAction([entity("light.one", "off"), entity("light.two", "off"), entity("light.three", "on")]).action).toBe("on");
  });

  it("counts unavailable lighting entities out of the shortcut vote", () => {
    const decision = decideLightShortcutAction([
      entity("light.one", "unavailable"),
      entity("light.two", "unknown"),
      entity("light.three", "on"),
    ]);

    expect(decision).toEqual({ action: "off", offCount: 0, onCount: 1, total: 1 });
  });

  it("includes illumination switches as lighting but excludes regular switches", () => {
    const lighting = shortcutLightingEntities([
      entity("light.one", "on"),
      entity("switch.neon", "on", { domain: "switch", isIllumination: true }),
      entity("switch.fan", "on", { domain: "switch" }),
    ]);

    expect(lighting.map((candidate) => candidate.entity_id)).toEqual(["light.one", "switch.neon"]);
  });

  it("builds shortcut target ids from all available lighting entities", () => {
    expect(shortcutTargetIdsFromEntities([
      entity("light.one", "on"),
      entity("switch.neon", "off", { domain: "switch", isIllumination: true }),
      entity("switch.fan", "on", { domain: "switch" }),
      entity("light.offline", "unknown"),
    ])).toEqual(["light.one", "switch.neon"]);
  });

  it("allows one accepted shortcut hit per target per second", () => {
    expect(claimLightShortcutCooldown("indoors", 1000)).toEqual({ allowed: true, lastAction: null, retryAfterMs: 0 });
    rememberLightShortcutAction("indoors", "on");
    expect(claimLightShortcutCooldown("indoors", 1500)).toEqual({ allowed: false, lastAction: "on", retryAfterMs: 500 });
    expect(claimLightShortcutCooldown("outside", 1500)).toEqual({ allowed: true, lastAction: null, retryAfterMs: 0 });
    expect(claimLightShortcutCooldown("all", 1500)).toEqual({ allowed: true, lastAction: null, retryAfterMs: 0 });
    expect(claimLightShortcutCooldown("indoors", 2000)).toEqual({ allowed: true, lastAction: "on", retryAfterMs: 0 });
  });
});
