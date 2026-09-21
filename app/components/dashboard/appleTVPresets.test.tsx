import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS } from "../../../lib/apple-tv/playlists";
import { PanelAppleTVPresets, QuickAppleTVPresets } from "./appleTVPresets";
import { appleTVAmpState, resetAppleTVAmpForTest } from "./appleTVAmpClient";

/** The host's answer to `/api/appletv`. */
function stubPlaylists(playlists: string[]) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ playlists }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

  it("marks the chosen playlist, and only the chosen one", async () => {
    stubPlaylists(DEFAULT_PLAYLISTS);
    render(<QuickAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    const second = screen.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[1]} on the Apple TV` });
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[0]} on the Apple TV` }).getAttribute("aria-pressed")).toBe("false");
    expect(appleTVAmpState().presetIndex).toBe(1);
  });

  it("sends nothing: the amplifier has no endpoint yet", async () => {
    const fetchMock = stubPlaylists(DEFAULT_PLAYLISTS);
    render(<QuickAppleTVPresets />);
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    const reads = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[0]} on the Apple TV` }));
    expect(fetchMock.mock.calls.length).toBe(reads);
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
