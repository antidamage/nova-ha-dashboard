import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYLISTS,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLISTS,
  cleanPlaylistName,
  cleanPlaylists,
  storedPlaylists,
} from "./playlists";

describe("the shipped presets", () => {
  it("are the three Adeline named, in order", () => {
    expect(DEFAULT_PLAYLISTS).toEqual(["Excellent", "Sword Smoke & Temple Drums", "Cool"]);
  });
});

describe("a playlist name", () => {
  it("is trimmed and its runs of whitespace collapsed", () => {
    expect(cleanPlaylistName("  Sword   Smoke  ")).toBe("Sword Smoke");
    expect(cleanPlaylistName("Cool\t\n")).toBe("Cool");
  });

  it("is bounded, so a long paste cannot run away with a preset row", () => {
    expect(cleanPlaylistName("x".repeat(200))).toHaveLength(MAX_PLAYLIST_NAME);
  });

  it("is empty for anything that is not a string", () => {
    expect(cleanPlaylistName(undefined)).toBe("");
    expect(cleanPlaylistName(7)).toBe("");
    expect(cleanPlaylistName(null)).toBe("");
  });
});

describe("the stored list", () => {
  it("drops blanks and duplicates, keeping the first spelling of each", () => {
    expect(cleanPlaylists(["Cool", "  ", "cool", "Excellent"])).toEqual(["Cool", "Excellent"]);
  });

  it("keeps at most the dial's six", () => {
    const many = Array.from({ length: 12 }, (_, index) => `Playlist ${index}`);
    expect(cleanPlaylists(many)).toHaveLength(MAX_PLAYLISTS);
  });

  it("is empty for a value that is not a list, so callers can tell it from unset", () => {
    expect(cleanPlaylists("Cool")).toEqual([]);
    expect(cleanPlaylists(undefined)).toEqual([]);
    expect(cleanPlaylists([])).toEqual([]);
  });
});

describe("the list a reader draws", () => {
  it("falls back to the shipped three when nothing is stored", () => {
    expect(storedPlaylists(undefined)).toEqual(DEFAULT_PLAYLISTS);
    expect(storedPlaylists(null)).toEqual(DEFAULT_PLAYLISTS);
    expect(storedPlaylists("Cool")).toEqual(DEFAULT_PLAYLISTS);
  });

  it("uses a stored list as it is, including an emptied one", () => {
    expect(storedPlaylists(["One"])).toEqual(["One"]);
    // Clearing every row is a decision, not a missing setting: restocking the
    // defaults here would make the removal silently impossible.
    expect(storedPlaylists([])).toEqual([]);
  });
});
