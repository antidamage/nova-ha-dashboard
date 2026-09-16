import { describe, expect, it } from "vitest";
import { glyphWriteForSave, parseRosterGlyphs, rosterGlyphFor } from "./reminder-roster-client";

const glyphs = parseRosterGlyphs({
  entries: [{ key: "take estrogen", glyph: { kind: "text", value: "E" } }, { key: "bad", glyph: 3 }],
});

describe("reminder roster client", () => {
  it("reads glyphs keyed by normalised name, with the fallback for unknown names", () => {
    expect(rosterGlyphFor(glyphs, "Take  Estrogen!")).toEqual({ kind: "text", value: "E" });
    expect(rosterGlyphFor(glyphs, "bad")).toEqual(rosterGlyphFor(glyphs, "nothing"));
  });

  it("writes a chosen glyph under the saved name", () => {
    expect(glyphWriteForSave({ chosen: { kind: "text", value: "W" }, glyphs, name: " Water " })).toEqual({
      key: "water",
      displayName: "Water",
      glyph: { kind: "text", value: "W" },
    });
  });

  it("carries the old key's glyph across a rename, and writes nothing otherwise", () => {
    expect(glyphWriteForSave({ chosen: null, glyphs, name: "Estrogen", previousName: "Take estrogen" })).toEqual({
      key: "estrogen",
      displayName: "Estrogen",
      glyph: { kind: "text", value: "E" },
    });
    expect(glyphWriteForSave({ chosen: null, glyphs, name: "TAKE estrogen", previousName: "Take estrogen" })).toBeNull();
    expect(glyphWriteForSave({ chosen: null, glyphs, name: "New one" })).toBeNull();
  });
});
