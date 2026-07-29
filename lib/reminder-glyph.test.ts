import { describe, expect, it } from "vitest";

import {
  FALLBACK_REMINDER_ICON_ID,
  REMINDER_ICON_CATALOG,
  REMINDER_ICON_IDS,
  isReminderIconId,
  matchReminderIconByKeyword,
  normalizeGlyph,
  normalizeReminderKey,
} from "./reminder-glyph";

describe("normalizeReminderKey", () => {
  it("collapses case, punctuation and spacing so one reminder is one key", () => {
    expect(normalizeReminderKey("Take Estrogen!")).toBe("take estrogen");
    expect(normalizeReminderKey("  take   estrogen  ")).toBe("take estrogen");
    expect(normalizeReminderKey("Take-Estrogen")).toBe("take estrogen");
  });

  it("strips diacritics so an accented respelling stays the same reminder", () => {
    expect(normalizeReminderKey("Café run")).toBe(normalizeReminderKey("Cafe run"));
  });

  // This is the property the whole store depends on: iCloud regenerates task
  // ids every sync, so the name is the only stable handle.
  it("is stable for the same name across differently-formatted repeats", () => {
    const first = normalizeReminderKey("Wash hair");
    const second = normalizeReminderKey("wash  HAIR");
    expect(first).toBe(second);
  });
});

describe("matchReminderIconByKeyword", () => {
  it("resolves the household chores the bar was built for", () => {
    expect(matchReminderIconByKeyword("Take estrogen")).toBe("pill");
    expect(matchReminderIconByKeyword("Put the washing on")).toBe("washing-machine");
    expect(matchReminderIconByKeyword("Pay rent")).toBe("currency-dollar");
    expect(matchReminderIconByKeyword("Bins out")).toBe("trash");
  });

  it("prefers the longest match, so 'wash hair' is a shower not a washing machine", () => {
    expect(matchReminderIconByKeyword("Wash hair tonight")).toBe("shower");
  });

  it("matches whole words only, so 'car' does not fire on 'carrot'", () => {
    expect(matchReminderIconByKeyword("Buy carrots")).not.toBe("car");
    expect(matchReminderIconByKeyword("Car WOF")).toBe("car");
  });

  it("returns null when nothing plausibly fits", () => {
    expect(matchReminderIconByKeyword("Zzzzyx qwrtp")).toBeNull();
  });
});

describe("catalogue integrity", () => {
  it("has no duplicate ids", () => {
    expect(new Set(REMINDER_ICON_IDS).size).toBe(REMINDER_ICON_IDS.length);
  });

  it("includes the fallback, because every unmatched reminder resolves to it", () => {
    expect(isReminderIconId(FALLBACK_REMINDER_ICON_ID)).toBe(true);
  });

  it("gives every entry at least one keyword to match on", () => {
    for (const entry of REMINDER_ICON_CATALOG) {
      expect(entry.keywords.length, `${entry.id} has no keywords`).toBeGreaterThan(0);
    }
  });
});

describe("normalizeGlyph", () => {
  it("accepts a catalogue icon and rejects an unknown one", () => {
    expect(normalizeGlyph({ kind: "phosphor", id: "pill" })).toEqual({ kind: "phosphor", id: "pill" });
    expect(normalizeGlyph({ kind: "phosphor", id: "not-a-real-icon" })).toBeNull();
  });

  it("clamps a text glyph to two characters", () => {
    expect(normalizeGlyph({ kind: "text", value: "ESTROGEN" })).toEqual({ kind: "text", value: "ES" });
    expect(normalizeGlyph({ kind: "text", value: " E " })).toEqual({ kind: "text", value: "E" });
  });

  it("rejects an empty text glyph rather than rendering a blank tile", () => {
    expect(normalizeGlyph({ kind: "text", value: "   " })).toBeNull();
  });

  it("rejects junk", () => {
    expect(normalizeGlyph(null)).toBeNull();
    expect(normalizeGlyph("pill")).toBeNull();
    expect(normalizeGlyph({ kind: "svg", id: "pill" })).toBeNull();
  });
});
