import * as Tooltip from "@radix-ui/react-tooltip";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(appleTVAmpState().playlists).toEqual(DEFAULT_PLAYLISTS);
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
    expect(host.writes[0]).toEqual([DEFAULT_PLAYLISTS[0], DEFAULT_PLAYLISTS[2]]);
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
    expect(host.writes[0]).toEqual([DEFAULT_PLAYLISTS[1], DEFAULT_PLAYLISTS[2]]);
  });

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
      pending[1]({ ok: true, json: async () => ({ playlists: ["First rename", "Second rename", DEFAULT_PLAYLISTS[2]] }) });
    });
    await act(async () => {
      pending[0]({ ok: false, status: 500, json: async () => ({ error: "nope" }) });
    });

    // The failed earlier save must not restore a list the later one replaced.
    expect(appleTVAmpState().playlists).toEqual(["First rename", "Second rename", DEFAULT_PLAYLISTS[2]]);
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
