import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS, type AppleTVPlaylist } from "../../../lib/apple-tv/playlists";
import { PanelAppleTVPresets, QuickAppleTVPresets } from "./appleTVPresets";
import { appleTVAmpState, resetAppleTVAmpForTest } from "./appleTVAmpClient";

/** The host's answer to `/api/appletv`. Names alone are read as bare presets. */
function stubPlaylists(playlists: unknown[]) {
  // Args are declared so a test can read the call it made, not just count it.
  const fetchMock = vi.fn(async (_url: string, _init?: { body?: string; method?: string }) => ({
    ok: true,
    json: async () => ({ playlists }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const named = (name: string, rest: Partial<AppleTVPlaylist> = {}) => ({ name, ...rest });

beforeEach(() => {
  resetAppleTVAmpForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Apple TV preset row", () => {
  it("draws one button per playlist, named in its accessible label", async () => {
    stubPlaylists(DEFAULT_PLAYLISTS);
    render(<QuickAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    for (const name of DEFAULT_PLAYLISTS) {
      expect(screen.getByRole("button", { name: `Play ${name} on the Apple TV` })).toBeTruthy();
    }
  });

  it("fires the preset's play event at the Apple TV, and stays dark: a press is one shot", async () => {
    const fetchMock = stubPlaylists(DEFAULT_PLAYLISTS);
    render(<QuickAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    const reads = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[1]} on the Apple TV` }));

    // The event names the position: the route reads the stored list, so what it
    // plays is what the dial is showing.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(reads + 1));
    const [url, init] = fetchMock.mock.calls[reads];
    expect(url).toBe("/api/appletv/play");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ index: 1 });
    // Nothing is marked: not the pressed button, not any other, and the store
    // holds no chosen preset to mark one with.
    for (const button of screen.getAllByRole("button")) expect(button.getAttribute("aria-pressed")).toBeNull();
    expect(appleTVAmpState()).not.toHaveProperty("presetIndex");
  });

  it("draws the icon the editor gave it, and the note where none was chosen", async () => {
    stubPlaylists([named("Flame", { icon: "flame" }), named("Plain")]);
    const { container } = render(<PanelAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(2));

    const buttons = container.querySelectorAll(".apple-tv-presets button");
    expect(buttons[0].getAttribute("data-preset-icon")).toBe("flame");
    expect(buttons[0].querySelector("svg")?.getAttribute("class")).toContain("lucide-flame");
    expect(buttons[1].getAttribute("data-preset-icon")).toBe("note");
    expect(buttons[1].querySelector("svg")?.getAttribute("class")).toContain("lucide-music");
  });

  it("says how the preset plays in its label, and nothing when it is the ordinary case", async () => {
    stubPlaylists([
      named("Ordinary"),
      named("Party", { shuffle: true, repeat: "all" }),
      named("Sleep", { repeat: "infinite" }),
    ]);
    render(<PanelAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));

    expect(screen.getByRole("button", { name: "Play Ordinary on the Apple TV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Party on the Apple TV (shuffled, looping)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Sleep on the Apple TV (endless)" })).toBeTruthy();
  });

  it("draws the host's list, whatever its length", async () => {
    stubPlaylists(["Excellent", "Sword Smoke & Temple Drums"]);
    render(<PanelAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Play Excellent on the Apple TV" })).toBeTruthy();
  });

  it("draws no row at all for a dial with no playlists", async () => {
    stubPlaylists([]);
    const { container } = render(<QuickAppleTVPresets />);
    await waitFor(() => expect(appleTVAmpState().loaded).toBe(true));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
