import { describe, expect, it } from "vitest";
import {
  VOICE_SETTINGS_DEFAULTS,
  normalizeVoiceSettings,
  parseVoiceSettingsUpdate,
} from "../voice-settings";

describe("voice settings", () => {
  it("normalizes and updates the conversation window", () => {
    expect(normalizeVoiceSettings(null).conversationIdleSeconds).toBe(60);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 123 }).conversationIdleSeconds).toBe(125);
    expect(normalizeVoiceSettings({ conversationIdleSeconds: 9999 }).conversationIdleSeconds).toBe(300);
    expect(parseVoiceSettingsUpdate({ conversationIdleSeconds: 90 })).toEqual({
      conversationIdleSeconds: 90,
    });
  });

  it("normalizes and updates the absolute conversation limit", () => {
    // The idle window is refreshed by every engaged turn, so it cannot bound a
    // conversation on its own; this is the backstop that always closes it.
    expect(normalizeVoiceSettings(null).conversationMaxSeconds).toBe(300);
    expect(normalizeVoiceSettings({ conversationMaxSeconds: 100 }).conversationMaxSeconds).toBe(90);
    expect(normalizeVoiceSettings({ conversationMaxSeconds: 9999 }).conversationMaxSeconds)
      .toBe(1800);
    expect(parseVoiceSettingsUpdate({ conversationMaxSeconds: 600 })).toEqual({
      conversationMaxSeconds: 600,
    });
  });

  it("defaults voice training on and only an explicit false turns it off", () => {
    // A partial or legacy preferences blob must never silently stop the
    // household being listened to.
    expect(normalizeVoiceSettings(null).voiceTrainingEnabled).toBe(true);
    expect(normalizeVoiceSettings({}).voiceTrainingEnabled).toBe(true);
    expect(normalizeVoiceSettings({ voiceTrainingEnabled: false }).voiceTrainingEnabled).toBe(false);
    expect(parseVoiceSettingsUpdate({ voiceTrainingEnabled: false })).toEqual({
      voiceTrainingEnabled: false,
    });
    expect(() => parseVoiceSettingsUpdate({ voiceTrainingEnabled: "no" }))
      .toThrow(/must be true or false/);
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
});
