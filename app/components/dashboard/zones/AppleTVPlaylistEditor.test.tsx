import * as Tooltip from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS, type AppleTVPlaylist } from "../../../../lib/apple-tv/playlists";
import { AppleTVPlaylistEditor } from "./AppleTVPlaylistEditor";
import { appleTVAmpState, resetAppleTVAmpForTest } from "../appleTVAmpClient";

/** The names a list of presets holds, which is what a name test is about. */
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
    expect(names(host.writes[0])).toEqual(["Excellent (2)", DEFAULT_PLAYLISTS[1], DEFAULT_PLAYLISTS[2]]);
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
    expect(names(appleTVAmpState().playlists)).toEqual(DEFAULT_PLAYLISTS);
  });

  it("refuses a duplicate the list would only see after its own normalisation", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const second = screen.getAllByRole("textbox")[1];
    // An internal double space and a tab survive a raw comparison but collapse
    // to the same name under the list's own normalisation, which is why the
    // guard has to compare what the list stores (leading and trailing spaces
    // are already trimmed into `name` before it is compared).
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "  Excellent  " } });
    fireEvent.blur(second);
    expect(await screen.findByRole("alert")).toHaveTextContent("is already in the list");
    expect(host.writes).toHaveLength(0);

    const third = screen.getAllByRole("textbox")[2];
    fireEvent.focus(third);
    fireEvent.change(third, { target: { value: `Sword   Smoke &\tTemple Drums` } });
    fireEvent.blur(third);
    expect(await screen.findByRole("alert")).toHaveTextContent("is already in the list");
    expect(host.writes).toHaveLength(0);
    expect(names(appleTVAmpState().playlists)).toEqual(DEFAULT_PLAYLISTS);
  });

  it("clears the alert once the field is put back", async () => {
    stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const second = screen.getAllByRole("textbox")[1];
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Cool" } });
    fireEvent.blur(second);
    expect(await screen.findByRole("alert")).toBeTruthy();

    // Putting the stored name back is a no-op commit, and must not leave the
    // message about a name that is no longer anywhere in the list.
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: DEFAULT_PLAYLISTS[1] } });
    fireEvent.blur(second);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("clears the alert when the row is emptied instead", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const second = screen.getAllByRole("textbox")[1];
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Cool" } });
    fireEvent.blur(second);
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "   " } });
    fireEvent.blur(second);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(names(host.writes[0])).toEqual([DEFAULT_PLAYLISTS[0], DEFAULT_PLAYLISTS[2]]);
  });

  it("treats an emptied row as a removal rather than storing a blank", async () => {
    const host = stubHost();
    renderEditor();
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const first = screen.getAllByRole("textbox")[0];
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "   " } });
    fireEvent.blur(first);
    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(names(host.writes[0])).toEqual([DEFAULT_PLAYLISTS[1], DEFAULT_PLAYLISTS[2]]);
  });
});
