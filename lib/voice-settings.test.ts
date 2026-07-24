import { describe, expect, it } from "vitest";
import {
  VOICE_SETTINGS_DEFAULTS,
  normalizeVoiceSettings,
  normalizeVoicePersonalitySet,
  parseVoiceSettingsUpdate,
  voicePersonalitySignature,
  voicePersonalitySubset,
} from "./voice-settings";

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

  it("normalizes and updates the conversation window", () => {
    expect(normalizeVoiceSettings(null).conversationIdleSeconds).toBe(60);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 123 }).conversationIdleSeconds).toBe(125);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 9999 }).conversationIdleSeconds).toBe(300);
    expect(parseVoiceSettingsUpdate({ conversationIdleSeconds: 90 })).toEqual({
      conversationIdleSeconds: 90,
    });
  });

  it("normalizes and updates the transcript decoration template", () => {
    expect(normalizeVoiceSettings(null).transcriptTemplate).toBe(
      "╭─[ %u%%a% ➤ %d% %t% ➤ [%m%] ]",
    );
    expect(normalizeVoiceSettings({ transcriptTemplate: "" }).transcriptTemplate).toBe(
      VOICE_SETTINGS_DEFAULTS.transcriptTemplate,
    );
    expect(normalizeVoiceSettings({ transcriptTemplate: "%u%%a% said at %t%:" }).transcriptTemplate)
      .toBe("%u%%a% said at %t%:");
    expect(parseVoiceSettingsUpdate({ transcriptTemplate: "%d% %t% [%m%]" })).toEqual({
      transcriptTemplate: "%d% %t% [%m%]",
    });
    // "" persists as a reset request; normalization restores the stock decoration.
    expect(parseVoiceSettingsUpdate({ transcriptTemplate: "" })).toEqual({ transcriptTemplate: "" });
    expect(() => parseVoiceSettingsUpdate({ transcriptTemplate: "x".repeat(201) })).toThrow(
      "at most 200 characters",
    );
  });

  it("normalizes and updates the playback preroll and frame size", () => {
    expect(normalizeVoiceSettings(null).ttsPrerollMs).toBe(400);
    expect(normalizeVoiceSettings(null).ttsFrameMs).toBe(100);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 730 }).ttsPrerollMs).toBe(730);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 5 }).ttsPrerollMs).toBe(20);
    expect(normalizeVoiceSettings({ ttsPrerollMs: 9999 }).ttsPrerollMs).toBe(2000);
    expect(normalizeVoiceSettings({ ttsFrameMs: 37 }).ttsFrameMs).toBe(40);
    expect(parseVoiceSettingsUpdate({ ttsPrerollMs: 500 })).toEqual({ ttsPrerollMs: 500 });
    expect(parseVoiceSettingsUpdate({ ttsFrameMs: 60 })).toEqual({ ttsFrameMs: 60 });
  });

  it("defaults pronouns to they/them/theirs", () => {
    expect(normalizeVoiceSettings(null).pronouns).toEqual({
      subjective: "they",
      objective: "them",
      possessive: "theirs",
    });
  });

  it("normalizes each pronoun form independently and falls back per field", () => {
    expect(normalizeVoiceSettings({
      pronouns: { subjective: " She ", objective: "her", possessive: "" },
    }).pronouns).toEqual({ subjective: "she", objective: "her", possessive: "theirs" });
    // A non-string or invalid form falls back rather than corrupting the set.
    expect(normalizeVoiceSettings({
      pronouns: { subjective: "xe", objective: 5, possessive: "with space" },
    } as unknown as Parameters<typeof normalizeVoiceSettings>[0]).pronouns).toEqual({
      subjective: "xe",
      objective: "them",
      possessive: "theirs",
    });
  });

  it("accepts a valid pronoun update and rejects a malformed one", () => {
    expect(parseVoiceSettingsUpdate({
      pronouns: { subjective: "Xe", objective: "Xem", possessive: "Xyrs" },
    })).toEqual({ pronouns: { subjective: "xe", objective: "xem", possessive: "xyrs" } });
    expect(() => parseVoiceSettingsUpdate({ pronouns: { subjective: "she" } })).toThrow();
    expect(() => parseVoiceSettingsUpdate({ pronouns: "she/her" })).toThrow(
      "must be an object",
    );
  });

  it("defaults every affectation off and only honours literal true", () => {
    expect(normalizeVoiceSettings(null).affectations).toEqual({ pronounDrop: false });
    expect(normalizeVoiceSettings({ affectations: { pronounDrop: true } }).affectations)
      .toEqual({ pronounDrop: true });
    // Truthy junk and unknown keys must not switch a quirk on.
    expect(normalizeVoiceSettings({
      affectations: { pronounDrop: "yes", telegraphSpeech: true },
    } as unknown as Parameters<typeof normalizeVoiceSettings>[0]).affectations)
      .toEqual({ pronounDrop: false });
  });

  it("accepts a valid affectations update and rejects a malformed one", () => {
    expect(parseVoiceSettingsUpdate({ affectations: { pronounDrop: true } }))
      .toEqual({ affectations: { pronounDrop: true } });
    // A posted object is the complete set: missing flags turn off.
    expect(parseVoiceSettingsUpdate({ affectations: {} }))
      .toEqual({ affectations: { pronounDrop: false } });
    expect(() => parseVoiceSettingsUpdate({ affectations: { pronounDrop: "on" } })).toThrow(
      "must be true or false",
    );
    expect(() => parseVoiceSettingsUpdate({ affectations: ["pronounDrop"] })).toThrow(
      "must be an object",
    );
  });

  it("clamps and steps the command reply length to whole words 0-10", () => {
    expect(normalizeVoiceSettings(null).commandReplyMaxWords).toBe(3);
    expect(normalizeVoiceSettings({ commandReplyMaxWords: 0 }).commandReplyMaxWords).toBe(0);
    expect(normalizeVoiceSettings({ commandReplyMaxWords: 7.6 }).commandReplyMaxWords).toBe(8);
    // Out-of-range values clamp to the 0-10 bounds.
    expect(normalizeVoiceSettings({ commandReplyMaxWords: 99 }).commandReplyMaxWords).toBe(10);
    expect(normalizeVoiceSettings({ commandReplyMaxWords: -4 }).commandReplyMaxWords).toBe(0);
    expect(parseVoiceSettingsUpdate({ commandReplyMaxWords: 5 }))
      .toEqual({ commandReplyMaxWords: 5 });
  });

  it("normalizes and parses the per-satellite killswitch list", () => {
    expect(normalizeVoiceSettings(null).disabledSatellites).toEqual(["nocturnium"]);
    expect(normalizeVoiceSettings({ disabledSatellites: [] }).disabledSatellites).toEqual([]);
    // Casefolded, de-duplicated, blanks/non-strings dropped, order preserved.
    expect(
      normalizeVoiceSettings({
        disabledSatellites: ["Indium", "indium", " nocturnium ", 5, ""],
      } as unknown as Parameters<typeof normalizeVoiceSettings>[0]).disabledSatellites,
    ).toEqual(["indium", "nocturnium"]);

    expect(parseVoiceSettingsUpdate({ disabledSatellites: ["Indium"] }))
      .toEqual({ disabledSatellites: ["indium"] });
    expect(parseVoiceSettingsUpdate({ disabledSatellites: [] }))
      .toEqual({ disabledSatellites: [] });
    expect(() => parseVoiceSettingsUpdate({ disabledSatellites: "indium" })).toThrow(
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
