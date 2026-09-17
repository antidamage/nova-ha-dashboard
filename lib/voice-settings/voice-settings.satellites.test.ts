import { describe, expect, it } from "vitest";
import {
  normalizeVoiceSettings,
  parseVoiceSettingsUpdate,
} from "../voice-settings";

describe("voice settings", () => {
  it("normalizes and parses the per-satellite killswitch list", () => {
    // Nothing muted by default: which satellites a house wants off depends on
    // which ones it has, so the product ships no opinion.
    expect(normalizeVoiceSettings(null).disabledSatellites).toEqual([]);
    expect(normalizeVoiceSettings({ disabledSatellites: [] }).disabledSatellites).toEqual([]);
    // Casefolded, de-duplicated, blanks/non-strings dropped, order preserved.
    expect(
      normalizeVoiceSettings({
        disabledSatellites: ["Kitchen", "kitchen", " study ", 5, ""],
      } as unknown as Parameters<typeof normalizeVoiceSettings>[0]).disabledSatellites,
    ).toEqual(["kitchen", "study"]);

    expect(parseVoiceSettingsUpdate({ disabledSatellites: ["Kitchen"] }))
      .toEqual({ disabledSatellites: ["kitchen"] });
    expect(parseVoiceSettingsUpdate({ disabledSatellites: [] }))
      .toEqual({ disabledSatellites: [] });
    expect(() => parseVoiceSettingsUpdate({ disabledSatellites: "kitchen" })).toThrow(
      "must be an array",
    );
  });

  it("defaults the satellite noise gate on and allows a diagnostic bypass", () => {
    expect(normalizeVoiceSettings(null).satelliteNoiseGateEnabled).toBe(true);
    expect(normalizeVoiceSettings({ satelliteNoiseGateEnabled: false }).satelliteNoiseGateEnabled)
      .toBe(false);
    expect(parseVoiceSettingsUpdate({ satelliteNoiseGateEnabled: false }))
      .toEqual({ satelliteNoiseGateEnabled: false });
    expect(() => parseVoiceSettingsUpdate({ satelliteNoiseGateEnabled: "off" })).toThrow(
      "must be true or false",
    );
  });

  it("keeps web access off by default and only honours an explicit true", () => {
    expect(normalizeVoiceSettings(null).webAccessEnabled).toBe(false);
    expect(normalizeVoiceSettings({ webAccessEnabled: true }).webAccessEnabled).toBe(true);
    // A missing or non-boolean value must never silently open outbound web calls.
    expect(normalizeVoiceSettings({ webAccessEnabled: "yes" as unknown as boolean }).webAccessEnabled)
      .toBe(false);
    expect(parseVoiceSettingsUpdate({ webAccessEnabled: true })).toEqual({ webAccessEnabled: true });
    expect(() => parseVoiceSettingsUpdate({ webAccessEnabled: "on" })).toThrow(/must be true or false/);
  });

  it("defaults the web backend to brave and rejects non-offered backends", () => {
    expect(normalizeVoiceSettings(null).webBackend).toBe("brave");
    expect(normalizeVoiceSettings({ webBackend: "local" }).webBackend).toBe("local");
    // Google is not offered: any non-offered stored value migrates to the default.
    expect(normalizeVoiceSettings({ webBackend: "gemini" }).webBackend).toBe("brave");
    expect(parseVoiceSettingsUpdate({ webBackend: "brave" })).toEqual({ webBackend: "brave" });
    expect(parseVoiceSettingsUpdate({ webBackend: "local" })).toEqual({ webBackend: "local" });
    expect(() => parseVoiceSettingsUpdate({ webBackend: "gemini" }))
      .toThrow("Unsupported voice webBackend");
  });

  it("clamps the web answer length to 1-5 sentences", () => {
    expect(normalizeVoiceSettings(null).webAnswerMaxSentences).toBe(2);
    expect(normalizeVoiceSettings({ webAnswerMaxSentences: 0 }).webAnswerMaxSentences).toBe(1);
    expect(normalizeVoiceSettings({ webAnswerMaxSentences: 99 }).webAnswerMaxSentences).toBe(5);
    expect(parseVoiceSettingsUpdate({ webAnswerMaxSentences: 4 }))
      .toEqual({ webAnswerMaxSentences: 4 });
  });
  it("preserves the full precision declared by decimal ranges", () => {
    expect(normalizeVoiceSettings({ longResponseProbability: 0.07 }).longResponseProbability).toBe(0.07);
    expect(normalizeVoiceSettings({ temperature: 1.3 }).temperature).toBe(1.3);
  });
});
