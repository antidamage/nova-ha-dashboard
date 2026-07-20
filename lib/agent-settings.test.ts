import { describe, expect, it } from "vitest";
import {
  AGENT_SETTINGS_DEFAULTS,
  normalizeAgentSettings,
  parseAgentSettingsUpdate,
} from "./agent-settings";

describe("agent settings", () => {
  it("defaults to a bounded enabled Ralph loop", () => {
    expect(normalizeAgentSettings()).toEqual(AGENT_SETTINGS_DEFAULTS);
  });

  it("normalizes stale values into safe bounds", () => {
    expect(normalizeAgentSettings({
      ralphLoopEnabled: false,
      ralphLoopFailureSeconds: 999,
      ralphLoopMaxIterations: 0,
      ralphLoopSleepMs: 549,
    })).toMatchObject({
      ralphLoopEnabled: false,
      ralphLoopFailureSeconds: 30,
      ralphLoopMaxIterations: 1,
      ralphLoopSleepMs: 500,
    });
  });

  it("accepts partial updates and rejects malformed values", () => {
    expect(parseAgentSettingsUpdate({ ralphLoopMaxIterations: 7.6 })).toEqual({
      ralphLoopMaxIterations: 8,
    });
    expect(parseAgentSettingsUpdate({ ralphLoopEnabled: false })).toEqual({
      ralphLoopEnabled: false,
    });
    expect(() => parseAgentSettingsUpdate({ ralphLoopEnabled: "yes" })).toThrow(
      "must be true or false",
    );
    expect(() => parseAgentSettingsUpdate({})).toThrow("No agent settings provided");
  });
});
