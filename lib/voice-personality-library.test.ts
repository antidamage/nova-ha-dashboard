import { describe, expect, it } from "vitest";
import {
  emptyVoicePersonalityLibrary,
  normalizeVoicePersonalityLibrary,
  VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES,
  VOICE_PERSONALITY_LIBRARY_MAX_NAME_LENGTH,
} from "./voice-personality-library";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "a",
    name: "Butler",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    personality: {
      speaker: "Aiden",
      accent: "british",
      pronouns: { subjective: "he", objective: "him", possessive: "his" },
    },
    ...overrides,
  };
}

describe("normalizeVoicePersonalityLibrary", () => {
  it("returns an empty library for non-objects", () => {
    expect(normalizeVoicePersonalityLibrary(null)).toEqual(emptyVoicePersonalityLibrary());
    expect(normalizeVoicePersonalityLibrary("nope")).toEqual(emptyVoicePersonalityLibrary());
    expect(normalizeVoicePersonalityLibrary([])).toEqual(emptyVoicePersonalityLibrary());
  });

  it("keeps valid entries, preserves order, and normalizes the personality set", () => {
    const library = normalizeVoicePersonalityLibrary({
      activeId: "b",
      entries: [entry({ id: "a", name: "First" }), entry({ id: "b", name: "Second" })],
    });
    expect(library.entries.map((item) => item.id)).toEqual(["a", "b"]);
    expect(library.activeId).toBe("b");
    // The stored personality is normalized: kept fields survive, missing ones
    // fall back to the settings defaults.
    expect(library.entries[0].personality.speaker).toBe("Aiden");
    expect(library.entries[0].personality.accent).toBe("british");
    expect(library.entries[0].personality.pronouns).toEqual({
      subjective: "he",
      objective: "him",
      possessive: "his",
    });
    expect(library.entries[0].personality.emotion).toBe("natural");
  });

  it("repairs an entry with a missing personality rather than dropping it", () => {
    const library = normalizeVoicePersonalityLibrary({ entries: [entry({ personality: undefined })] });
    expect(library.entries).toHaveLength(1);
    expect(library.entries[0].personality.speaker).toBe("Ryan");
    expect(library.entries[0].personality.pronouns.subjective).toBe("they");
  });

  it("clears activeId when it does not match a surviving entry", () => {
    const library = normalizeVoicePersonalityLibrary({ activeId: "missing", entries: [entry()] });
    expect(library.activeId).toBeNull();
  });

  it("de-duplicates ids and assigns fresh ones", () => {
    const library = normalizeVoicePersonalityLibrary({
      entries: [entry({ id: "dup" }), entry({ id: "dup" })],
    });
    const ids = library.entries.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("trims names, caps their length, and falls back when empty", () => {
    const long = "x".repeat(200);
    const library = normalizeVoicePersonalityLibrary({
      entries: [entry({ name: `  ${long}  ` }), entry({ id: "c", name: "   " })],
    });
    expect(library.entries[0].name).toHaveLength(VOICE_PERSONALITY_LIBRARY_MAX_NAME_LENGTH);
    expect(library.entries[1].name).toBe("Untitled personality");
  });

  it("caps the number of entries", () => {
    const entries = Array.from({ length: VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES + 10 }, (_, index) =>
      entry({ id: `id-${index}` }),
    );
    const library = normalizeVoicePersonalityLibrary({ entries });
    expect(library.entries).toHaveLength(VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES);
  });
});
