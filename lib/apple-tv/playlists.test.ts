import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYLISTS,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLISTS,
  REPEAT_MODE_LABELS,
  cleanPlaylistEntry,
  cleanPlaylistName,
  cleanPlaylists,
  cleanRepeatMode,
  nextRepeatMode,
  playlistModeWords,
  storedPlaylists,
  type AppleTVPlaylist,
} from "./playlists";

/** The preset a name carries once nothing is set on it. */
const plain = (name: string): AppleTVPlaylist => ({ name, icon: null, shuffle: false, repeat: "off" });

const names = (list: { name: string }[]) => list.map((preset) => preset.name);

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

describe("a preset's playback type", () => {
  it("is the three Apple Music plays through, whatever else is stored", () => {
    expect(cleanRepeatMode("off")).toBe("off");
    expect(cleanRepeatMode("all")).toBe("all");
    expect(cleanRepeatMode("infinite")).toBe("infinite");
    // A mode this build does not know reads as no repeat rather than as a mode
    // nobody asked the dial to play.
    expect(cleanRepeatMode("sometimes")).toBe("off");
    expect(cleanRepeatMode(undefined)).toBe("off");
    expect(cleanRepeatMode(true)).toBe("off");
  });

  it("cycles play once, loop, endless, round again", () => {
    expect(nextRepeatMode("off")).toBe("all");
    expect(nextRepeatMode("all")).toBe("infinite");
    expect(nextRepeatMode("infinite")).toBe("off");
  });

  it("is named for a person wherever it is read", () => {
    expect(REPEAT_MODE_LABELS).toEqual({ off: "Play once", all: "Loop", infinite: "Endless" });
  });
});

describe("one stored preset", () => {
  it("is read from a bare name, which is how the shipped list stores them", () => {
    expect(cleanPlaylistEntry("Excellent")).toEqual(plain("Excellent"));
  });

  it("carries the icon and the playback type it was given", () => {
    expect(cleanPlaylistEntry({ name: "Cool", icon: "flame", shuffle: true, repeat: "infinite" }))
      .toEqual({ name: "Cool", icon: "flame", shuffle: true, repeat: "infinite" });
  });

  it("reads anything it cannot honour as unset, so the button still draws", () => {
    expect(cleanPlaylistEntry({ name: "Cool", icon: "saxophone", shuffle: "yes", repeat: "sometimes" }))
      .toEqual(plain("Cool"));
  });

  it("is nothing at all without a name to store", () => {
    expect(cleanPlaylistEntry({ name: "   ", icon: "flame" })).toBeNull();
    expect(cleanPlaylistEntry(7)).toBeNull();
    expect(cleanPlaylistEntry(null)).toBeNull();
    expect(cleanPlaylistEntry({})).toBeNull();
  });
});

describe("what a preset does, in words", () => {
  it("says nothing for the ordinary preset, which is what a playlist does anyway", () => {
    expect(playlistModeWords(plain("Cool"))).toEqual([]);
  });

  it("names the shuffle and the repeat it was given", () => {
    expect(playlistModeWords({ ...plain("Cool"), shuffle: true })).toEqual(["shuffled"]);
    expect(playlistModeWords({ ...plain("Cool"), repeat: "all" })).toEqual(["looping"]);
    expect(playlistModeWords({ ...plain("Cool"), repeat: "infinite" })).toEqual(["endless"]);
    expect(playlistModeWords({ name: "Cool", icon: "flame", shuffle: true, repeat: "all" }))
      .toEqual(["shuffled", "looping"]);
  });
});

describe("the stored list", () => {
  it("drops blanks and duplicates, keeping the first spelling of each", () => {
    expect(names(cleanPlaylists(["Cool", "  ", "cool", "Excellent"]))).toEqual(["Cool", "Excellent"]);
  });

  it("keeps at most the dial's six", () => {
    const many = Array.from({ length: 12 }, (_, index) => `Playlist ${index}`);
    expect(cleanPlaylists(many)).toHaveLength(MAX_PLAYLISTS);
  });

  it("keeps each preset's own icon and playback type through the de-duplication", () => {
    const stored = cleanPlaylists([
      { name: "Cool", icon: "skull", shuffle: true, repeat: "all" },
      { name: "cool", icon: "flame" },
    ]);
    expect(stored).toEqual([{ name: "Cool", icon: "skull", shuffle: true, repeat: "all" }]);
  });

  it("is empty for a value that is not a list, so callers can tell it from unset", () => {
    expect(cleanPlaylists("Cool")).toEqual([]);
    expect(cleanPlaylists(undefined)).toEqual([]);
    expect(cleanPlaylists([])).toEqual([]);
  });
});

describe("the list a reader draws", () => {
  it("falls back to the shipped three when nothing is stored", () => {
    const shipped = DEFAULT_PLAYLISTS.map(plain);
    expect(storedPlaylists(undefined)).toEqual(shipped);
    expect(storedPlaylists(null)).toEqual(shipped);
    expect(storedPlaylists("Cool")).toEqual(shipped);
  });

  it("reads a list written before the icons and playback types existed", () => {
    expect(storedPlaylists(["One", "Two"])).toEqual([plain("One"), plain("Two")]);
  });

  it("uses a stored list as it is, including an emptied one", () => {
    expect(names(storedPlaylists([{ name: "One", icon: "star" }]))).toEqual(["One"]);
    // Clearing every row is a decision, not a missing setting: restocking the
    // defaults here would make the removal silently impossible.
    expect(storedPlaylists([])).toEqual([]);
  });
});
