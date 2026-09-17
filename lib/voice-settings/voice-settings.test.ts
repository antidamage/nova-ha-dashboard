import { describe, expect, it } from "vitest";
import {
  VOICE_SETTINGS_DEFAULTS,
  normalizeVoiceSettings,
  normalizeVoicePersonalitySet,
  parseVoiceSettingsUpdate,
  voicePersonalitySignature,
  voicePersonalitySubset,
} from "../voice-settings";

describe("voice settings", () => {
  it("provides a complete structured default", () => {
    expect(normalizeVoiceSettings()).toEqual(VOICE_SETTINGS_DEFAULTS);
  });

  it("defaults the system voice killswitch to on and only an explicit false disables it", () => {
    expect(normalizeVoiceSettings().systemVoiceEnabled).toBe(true);
    expect(normalizeVoiceSettings({ systemVoiceEnabled: false }).systemVoiceEnabled).toBe(false);
    // A missing or non-boolean value must never silently mute the house.
    expect(normalizeVoiceSettings({ systemVoiceEnabled: "off" as unknown as boolean }).systemVoiceEnabled)
      .toBe(true);
    expect(normalizeVoiceSettings({}).systemVoiceEnabled).toBe(true);
  });

  it("parses a system voice killswitch update and rejects non-boolean values", () => {
    expect(parseVoiceSettingsUpdate({ systemVoiceEnabled: false })).toEqual({ systemVoiceEnabled: false });
    expect(parseVoiceSettingsUpdate({ systemVoiceEnabled: true })).toEqual({ systemVoiceEnabled: true });
    expect(() => parseVoiceSettingsUpdate({ systemVoiceEnabled: "no" })).toThrow(/must be true or false/);
  });

  it("defaults local speaker recognition on and accepts an explicit toggle", () => {
    expect(normalizeVoiceSettings().speakerRecognitionEnabled).toBe(true);
    expect(normalizeVoiceSettings({ speakerRecognitionEnabled: false }).speakerRecognitionEnabled)
      .toBe(false);
    expect(parseVoiceSettingsUpdate({ speakerRecognitionEnabled: false })).toEqual({
      speakerRecognitionEnabled: false,
    });
    expect(() => parseVoiceSettingsUpdate({ speakerRecognitionEnabled: "no" }))
      .toThrow(/must be true or false/);
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

  it("allows emoji and symbols in the display name", () => {
    expect(normalizeVoiceSettings({ agentName: "✨ Nova 🤖" }).agentName).toBe("✨ Nova 🤖");
    expect(parseVoiceSettingsUpdate({ agentName: "★ N0va! ★" })).toEqual({ agentName: "★ N0va! ★" });
    // An all-control-character / empty display name falls back to the default.
    expect(normalizeVoiceSettings({ agentName: "   " }).agentName).toBe(
      VOICE_SETTINGS_DEFAULTS.agentName,
    );
    expect(() => parseVoiceSettingsUpdate({ agentName: "" })).toThrow("1 to 40");
  });

  it("normalizes and updates the agent name pronunciation", () => {
    // Default and clearing collapse to an empty pronunciation.
    expect(normalizeVoiceSettings(null).agentNamePronunciation).toBe("");
    expect(normalizeVoiceSettings({ agentNamePronunciation: "  Nova  " }).agentNamePronunciation)
      .toBe("Nova");
    // A non-plain pronunciation (emoji) is dropped so the spoken name stays clean.
    expect(normalizeVoiceSettings({ agentNamePronunciation: "✨Nova" }).agentNamePronunciation)
      .toBe("");
    expect(parseVoiceSettingsUpdate({ agentNamePronunciation: " Nova " })).toEqual({
      agentNamePronunciation: "Nova",
    });
    // "" is an explicit clear and must survive the undefined-filter.
    expect(parseVoiceSettingsUpdate({ agentNamePronunciation: "" })).toEqual({
      agentNamePronunciation: "",
    });
    expect(() => parseVoiceSettingsUpdate({ agentNamePronunciation: "✨Nova" })).toThrow(
      "letters, numbers",
    );
  });
});

describe("voice personality subset", () => {
  it("captures only the personality-scoped fields", () => {
    const subset = voicePersonalitySubset(VOICE_SETTINGS_DEFAULTS);
    expect(Object.keys(subset).sort()).toEqual([
      "accent",
      "affectations",
      "commandReplyMaxWords",
      "commandReplyMinWords",
      "customSpeaker",
      "emotion",
      "emotionMirroring",
      "language",
      "longResponseProbability",
      "personality",
      "pitch",
      "pronouns",
      "speaker",
      "speechRate",
      "temperature",
      "trainedSpeaker",
    ].sort());
    // Global fields must not leak into a personality.
    expect(subset).not.toHaveProperty("agentName");
    expect(subset).not.toHaveProperty("volumeDay");
    expect(subset).not.toHaveProperty("wakeWords");
    expect(subset).not.toHaveProperty("ttsPrerollMs");
    // Engine tuning is global, not a personality trait.
    expect(subset).not.toHaveProperty("dotsNumSteps");
  });

  it("round-trips through normalizeVoicePersonalitySet", () => {
    const subset = voicePersonalitySubset(VOICE_SETTINGS_DEFAULTS);
    expect(normalizeVoicePersonalitySet(subset)).toEqual(subset);
  });

  it("changes signature when a personality field changes but not for global ones", () => {
    const base = voicePersonalitySubset(VOICE_SETTINGS_DEFAULTS);
    const sig = voicePersonalitySignature(base);
    expect(voicePersonalitySignature(voicePersonalitySubset(
      normalizeVoiceSettings({ ...VOICE_SETTINGS_DEFAULTS, volumeDay: 40 }),
    ))).toBe(sig);
    expect(voicePersonalitySignature(voicePersonalitySubset(
      normalizeVoiceSettings({ ...VOICE_SETTINGS_DEFAULTS, speaker: "Aiden" }),
    ))).not.toBe(sig);
    expect(voicePersonalitySignature(voicePersonalitySubset(
      normalizeVoiceSettings({ ...VOICE_SETTINGS_DEFAULTS, affectations: { pronounDrop: true } }),
    ))).not.toBe(sig);
  });
});
