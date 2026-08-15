import { describe, expect, it } from "vitest";
import {
  COMPANION_ROUTABLE_PASSES,
  normalizeVoiceSettings,
  parseVoiceSettingsUpdate,
} from "./voice-settings";

/**
 * Where each reasoning pass runs, as stored settings.
 *
 * The property that matters most is that an *absent* pass stays absent. The
 * voice server ships its own per-pass defaults; a dashboard that filled the map
 * in with guesses would pin every pass to whatever this file happened to think
 * the default was, and the two would drift apart silently the next time either
 * side changed.
 */
describe("companion routes", () => {
  it("defaults to an empty map, not to a guess at the server's defaults", () => {
    expect(normalizeVoiceSettings(null).companionRoutes).toEqual({});
  });

  it("keeps recognised passes and choices", () => {
    const settings = normalizeVoiceSettings({
      companionRoutes: { interpret: "local", classify_icon: "both" },
    });

    expect(settings.companionRoutes).toEqual({ interpret: "local", classify_icon: "both" });
  });

  it("drops an unknown pass rather than failing the whole settings read", () => {
    const settings = normalizeVoiceSettings({
      companionRoutes: { transcribe: "both", classify_icon: "companion" },
    });

    expect(settings.companionRoutes).toEqual({ classify_icon: "companion" });
  });

  it("drops an unknown choice", () => {
    const settings = normalizeVoiceSettings({
      companionRoutes: { interpret: "phone-only", classify_icon: "local" },
    });

    expect(settings.companionRoutes).toEqual({ classify_icon: "local" });
  });

  it("ignores a malformed map instead of throwing on read", () => {
    expect(normalizeVoiceSettings({ companionRoutes: ["local"] } as never).companionRoutes)
      .toEqual({});
    expect(normalizeVoiceSettings({ companionRoutes: "local" } as never).companionRoutes)
      .toEqual({});
  });

  it("rejects a malformed map on write, where the caller can be told", () => {
    expect(() => parseVoiceSettingsUpdate({ companionRoutes: "local" } as never)).toThrow(
      /companionRoutes/,
    );
  });

  it("covers every pass the voice server can route", () => {
    // A pass added on the server with no entry here would simply never appear
    // as a dropdown, which is a silent omission rather than a visible failure.
    expect([...COMPANION_ROUTABLE_PASSES]).toEqual([
      "interpret",
      "render_response",
      "confirm_objective",
      "extract_self_profile_update",
      "classify_icon",
    ]);
  });
});
