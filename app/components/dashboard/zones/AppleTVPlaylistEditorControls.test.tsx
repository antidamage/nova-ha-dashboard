import * as Tooltip from "@radix-ui/react-tooltip";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppleTVPlaylist } from "../../../../lib/apple-tv/playlists";
import { AppleTVPlaylistEditor } from "./AppleTVPlaylistEditor";
import { appleTVAmpState, resetAppleTVAmpForTest } from "../appleTVAmpClient";

/** Three presets already carrying icons and playback types of their own. */
const STORED: AppleTVPlaylist[] = [
  { name: "Excellent", icon: "flame", shuffle: false, repeat: "off" },
  { name: "Cool", icon: null, shuffle: true, repeat: "all" },
  { name: "Drums", icon: "drum", shuffle: false, repeat: "infinite" },
];

/** The host's answer to `/api/appletv`, with every write it was given. */
function stubHost() {
  const writes: AppleTVPlaylist[][] = [];
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body ?? "{}") as { playlists: AppleTVPlaylist[] };
      writes.push(body.playlists);
      return { ok: true, json: async () => ({ playlists: body.playlists }) };
    }
    return { ok: true, json: async () => ({ playlists: STORED }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writes, fetchMock };
}

beforeEach(() => {
  resetAppleTVAmpForTest();
});

function renderEditor() {
  return render(
    <Tooltip.Provider>
      <AppleTVPlaylistEditor />
    </Tooltip.Provider>,
  );
}

/** Wait for the store to have drawn the host's three presets. */
async function ready() {
  await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
  await waitFor(() => expect(appleTVAmpState().playlists[0]?.icon).toBe("flame"));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the icon a preset's button wears", () => {
  it("is the one the picker is given, saved as part of the preset", async () => {
    const host = stubHost();
    renderEditor();
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Icon for Cool" }));
    // The picker says what it is choosing for, and marks the note the preset
    // wears today.
    expect(await screen.findByRole("heading", { name: "Icon for Cool" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Note" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Headphones" }));
    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0][1]).toEqual({ name: "Cool", icon: "headphones", shuffle: true, repeat: "all" });
    // The dialog is done with, and the row's own button wears the new icon.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Icon for Cool" })).toBeNull());
    await waitFor(() => expect(appleTVAmpState().playlists[1].icon).toBe("headphones"));
  });

  it("is the note again once the note is chosen, which is how an icon comes off", async () => {
    const host = stubHost();
    renderEditor();
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "Icon for Excellent" }));
    expect(await screen.findByRole("heading", { name: "Icon for Excellent" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Note" }));

    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0][0]).toEqual({ name: "Excellent", icon: null, shuffle: false, repeat: "off" });
  });

  it("survives a rename: the preset is written whole, not name by name", async () => {
    const host = stubHost();
    renderEditor();
    await ready();

    const first = screen.getAllByRole("textbox")[0];
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Excellent (2)" } });
    fireEvent.blur(first);

    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0][0]).toEqual({ name: "Excellent (2)", icon: "flame", shuffle: false, repeat: "off" });
  });
});

describe("a preset's playback type", () => {
  it("cycles play once, loop and endless, saving each as it goes", async () => {
    const host = stubHost();
    renderEditor();
    await ready();

    // Excellent plays once to begin with, so its button says so.
    const repeat = screen.getByRole("button", { name: "Repeat Excellent: Play once" });
    expect(repeat.getAttribute("data-preset-repeat")).toBe("off");

    fireEvent.click(repeat);
    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0][0].repeat).toBe("all");
    await waitFor(() => expect(screen.getByRole("button", { name: "Repeat Excellent: Loop" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Repeat Excellent: Loop" }));
    await waitFor(() => expect(host.writes).toHaveLength(2));
    expect(host.writes[1][0].repeat).toBe("infinite");
    await waitFor(() => expect(screen.getByRole("button", { name: "Repeat Excellent: Endless" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Repeat Excellent: Endless" }));
    await waitFor(() => expect(host.writes).toHaveLength(3));
    expect(host.writes[2][0].repeat).toBe("off");
    await waitFor(() => expect(screen.getByRole("button", { name: "Repeat Excellent: Play once" })).toBeTruthy());
  });

  it("shuffles only the row it was switched on for", async () => {
    const host = stubHost();
    renderEditor();
    await ready();

    const shuffle = screen.getByRole("button", { name: "Shuffle Excellent" });
    expect(shuffle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(shuffle);

    await waitFor(() => expect(host.writes).toHaveLength(1));
    expect(host.writes[0].map((preset) => preset.shuffle)).toEqual([true, true, false]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Shuffle Excellent" }).getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Shuffle Excellent" }));
    await waitFor(() => expect(host.writes).toHaveLength(2));
    expect(host.writes[1].map((preset) => preset.shuffle)).toEqual([false, true, false]);
  });

  it("reads what is stored: a preset that loops, shuffles and wears a drum", async () => {
    stubHost();
    renderEditor();
    await ready();

    expect(screen.getByRole("button", { name: "Repeat Cool: Loop" }).getAttribute("data-preset-repeat")).toBe("all");
    expect(screen.getByRole("button", { name: "Shuffle Cool" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Repeat Drums: Endless" })).toBeTruthy();
  });
});
