import { describe, expect, it } from "vitest";
import {
  VOICE_SETTINGS_DEFAULTS,
  normalizeVoiceSettings,
  parseVoiceSettingsUpdate,
} from "./voice-settings";

describe("voice settings", () => {
  it("provides a complete structured default", () => {
    expect(normalizeVoiceSettings()).toEqual(VOICE_SETTINGS_DEFAULTS);
  });

  it("normalizes stale stored values and keeps a valid timestamp", () => {
    expect(normalizeVoiceSettings({
      accent: "new-zealand",
      emotionMirroring: 113,
      pitch: 99,
      speechRate: 87,
      volumeDay: 47,
      volumeNight: -10,
      updatedAt: "2026-07-15T01:02:03.000Z",
    })).toMatchObject({
      accent: "new-zealand",
      emotionMirroring: 110,
      pitch: 20,
      speechRate: 85,
      volumeDay: 45,
      volumeNight: 0,
      personality: "You are a bright, bubbly helper!",
      updatedAt: "2026-07-15T01:02:03.000Z",
    });
  });

  it("keeps an explicitly cleared personality and caps free text length", () => {
    expect(normalizeVoiceSettings({ personality: "" }).personality).toBe("");
    expect(parseVoiceSettingsUpdate({ personality: " Be dry and terse. " })).toEqual({
      personality: "Be dry and terse.",
    });
    expect(() => parseVoiceSettingsUpdate({ personality: "x".repeat(2001) })).toThrow(
      "at most 2000 characters",
    );
    expect(parseVoiceSettingsUpdate({ volumeNight: 33 })).toEqual({ volumeNight: 35 });
  });

  it("accepts partial updates, snaps sliders, and rejects prompt-like free text", () => {
    expect(parseVoiceSettingsUpdate({ speaker: "Aiden", speechRate: 117 })).toEqual({
      speaker: "Aiden",
      speechRate: 115,
    });
    expect(() => parseVoiceSettingsUpdate({ accent: "make it vaguely Kiwi" })).toThrow(
      "Unsupported voice accent",
    );
    expect(() => parseVoiceSettingsUpdate({})).toThrow("No voice settings provided");
  });

  it("migrates one legacy wake word and validates editable wake-word lists", () => {
    expect(normalizeVoiceSettings({ wakeWord: "beemo" }).wakeWords).toEqual(
      VOICE_SETTINGS_DEFAULTS.wakeWords,
    );
    expect(normalizeVoiceSettings({ wakeWord: "jarvis" }).wakeWords).toEqual(["jarvis"]);
    expect(parseVoiceSettingsUpdate({ wakeWords: ["beemo", "beamoh"] })).toEqual({
      wakeWords: ["beemo", "beamoh"],
    });
    expect(() => parseVoiceSettingsUpdate({ wakeWords: [] })).toThrow("1 to 12");
    expect(() => parseVoiceSettingsUpdate({ wakeWords: ["beemo", "beemo"] })).toThrow("duplicates");
  });

  it("preserves the configured agent name casing", () => {
    expect(normalizeVoiceSettings({ agentName: "  Beemo Prime  " }).agentName).toBe("Beemo Prime");
    expect(parseVoiceSettingsUpdate({ agentName: " Beemo Prime " })).toEqual({
      agentName: "Beemo Prime",
    });
  });

  it("normalizes and updates the conversation window", () => {
    expect(normalizeVoiceSettings(null).conversationIdleSeconds).toBe(60);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 123 }).conversationIdleSeconds).toBe(125);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 9999 }).conversationIdleSeconds).toBe(300);
    expect(parseVoiceSettingsUpdate({ conversationIdleSeconds: 90 })).toEqual({
      conversationIdleSeconds: 90,
    });
  });

  it("normalizes and updates the playback preroll and frame size", () => {
    expect(normalizeVoiceSettings(null).ttsPrerollMs).toBe(400);
    expect(normalizeVoiceSettings(null).ttsFrameMs).toBe(100);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 730 }).ttsPrerollMs).toBe(750);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 50 }).ttsPrerollMs).toBe(200);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 9999 }).ttsPrerollMs).toBe(2000);
    expect(normalizeVoiceSettings({ ttsFrameMs: 37 }).ttsFrameMs).toBe(40);
    expect(parseVoiceSettingsUpdate({ ttsPrerollMs: 500 })).toEqual({ ttsPrerollMs: 500 });
    expect(parseVoiceSettingsUpdate({ ttsFrameMs: 60 })).toEqual({ ttsFrameMs: 60 });
  });
});
