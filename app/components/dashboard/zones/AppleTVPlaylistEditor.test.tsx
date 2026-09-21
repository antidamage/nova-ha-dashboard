import * as Tooltip from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS } from "../../../../lib/apple-tv/playlists";
import { AppleTVPlaylistEditor } from "./AppleTVPlaylistEditor";
import { appleTVAmpState, resetAppleTVAmpForTest } from "../appleTVAmpClient";

/** The host's answer to `/api/appletv`, with the write it was given. */
function stubHost(options: { failWrites?: boolean } = {}) {
  const writes: unknown[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      if (options.failWrites) return { ok: false, status: 500, json: async () => ({ error: "nope" }) };
      const body = JSON.parse(init.body ?? "{}") as { playlists: string[] };
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

describe("the Apple TV playlist editor", () => {
  it("lists the stored playlists, in order, one row each", async () => {
    stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    for (const [index, name] of DEFAULT_PLAYLISTS.entries()) {
      expect((screen.getAllByRole("textbox")[index] as HTMLInputElement).value).toBe(name);
    }
  });

  it("saves a renamed playlist as the whole list", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const first = screen.getAllByRole("textbox")[0];
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Excellent (2)" } });
    fireEvent.blur(first);
    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0]).toEqual(["Excellent (2)", DEFAULT_PLAYLISTS[1], DEFAULT_PLAYLISTS[2]]);
  });

  it("refuses a name another row already carries rather than dropping that row", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const second = screen.getAllByRole("textbox")[1];
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "cool" } });
    fireEvent.blur(second);

    expect(await screen.findByRole("alert")).toHaveTextContent('"cool" is already in the list');
    expect(host.writes, "nothing was written").toHaveLength(0);
    // The row goes back to the stored name rather than disappearing on the next
    // read-back.
    await waitFor(() => expect((screen.getAllByRole("textbox")[1] as HTMLInputElement).value).toBe(DEFAULT_PLAYLISTS[1]));
    expect(appleTVAmpState().playlists).toEqual(DEFAULT_PLAYLISTS);
  });

  it("adds a new playlist, and stops at the list's six", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add playlist" }));
      await waitFor(() => expect(host.writes).toHaveLength(index + 1));
    }
    const names = appleTVAmpState().playlists;
    expect(names).toHaveLength(6);
    // Each new row is named uniquely, so a second add is not dropped as a
    // duplicate of the first.
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(6);
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
    await waitFor(() => expect(appleTVAmpState().playlists).toEqual(DEFAULT_PLAYLISTS));
    expect(host.writes).toHaveLength(0);
  });
});
