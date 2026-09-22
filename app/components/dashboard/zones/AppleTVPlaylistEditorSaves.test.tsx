import * as Tooltip from "@radix-ui/react-tooltip";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS, type AppleTVPlaylist } from "../../../../lib/apple-tv/playlists";
import { AppleTVPlaylistEditor } from "./AppleTVPlaylistEditor";
import { appleTVAmpState, resetAppleTVAmpForTest } from "../appleTVAmpClient";

/** The names a list of presets holds. */
const names = (presets: AppleTVPlaylist[]) => presets.map((preset) => preset.name);

/** The host's answer to `/api/appletv`, with the write it was given. */
function stubHost(options: { failWrites?: boolean } = {}) {
  const writes: AppleTVPlaylist[][] = [];
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      if (options.failWrites) return { ok: false, status: 500, json: async () => ({ error: "nope" }) };
      const body = JSON.parse(init.body ?? "{}") as { playlists: AppleTVPlaylist[] };
      writes.push(body.playlists);
      return { ok: true, json: async () => ({ playlists: body.playlists }) };
    }
    return { ok: true, json: async () => ({ playlists: DEFAULT_PLAYLISTS }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writes, fetchMock };
}

beforeEach(() => {
  resetAppleTVAmpForTest();
});

/**
 * The editor's buttons are the dashboard's `IconButton`, whose tooltip needs the
 * provider the dashboard root mounts (app/components/Dashboard.tsx).
 */
function renderEditor() {
  return render(
    <Tooltip.Provider>
      <AppleTVPlaylistEditor />
    </Tooltip.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Apple TV playlist editor, saving the list", () => {
  it("keeps a later save's list when an earlier one fails", async () => {
    const pending: Array<(value: unknown) => void> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "PUT") return new Promise((resolve) => pending.push(resolve));
      return { ok: true, json: async () => ({ playlists: DEFAULT_PLAYLISTS }) };
    }));
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));

    // Two renames, both in flight: the second save owns the list.
    const [first, second] = screen.getAllByRole("textbox");
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "First rename" } });
    fireEvent.blur(first);
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Second rename" } });
    fireEvent.blur(second);
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1]({ ok: true, json: async () => ({ playlists: [{ name: "First rename" }, { name: "Second rename" }, { name: DEFAULT_PLAYLISTS[2] }] }) });
    });
    await act(async () => {
      pending[0]({ ok: false, status: 500, json: async () => ({ error: "nope" }) });
    });

    // The failed earlier save must not restore a list the later one replaced.
    expect(names(appleTVAmpState().playlists)).toEqual(["First rename", "Second rename", DEFAULT_PLAYLISTS[2]]);
  });

  it("adds a new playlist, and stops at the list's six", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add playlist" }));
      await waitFor(() => expect(host.writes).toHaveLength(index + 1));
    }
    const added = names(appleTVAmpState().playlists);
    expect(added).toHaveLength(6);
    // Each new row is named uniquely, so a second add is not dropped as a
    // duplicate of the first.
    expect(new Set(added.map((name) => name.toLowerCase())).size).toBe(6);
    // And each arrives ready to be given an icon and a playback type.
    expect(appleTVAmpState().playlists[3]).toEqual({ name: "New playlist", icon: null, shuffle: false, repeat: "off" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add playlist" })).toBeDisabled());
  });

  it("rolls the dial back to the list the host still has when a save fails", async () => {
    const host = stubHost({ failWrites: true });
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Add playlist" }));

    // The failure is shown, and the list the dial draws is the one that is still
    // stored — not the rejected one.
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    await waitFor(() => expect(names(appleTVAmpState().playlists)).toEqual(DEFAULT_PLAYLISTS));
    expect(host.writes).toHaveLength(0);
  });
});
