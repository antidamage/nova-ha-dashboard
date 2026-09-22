import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppleTVAmp, appleTVAmpState, resetAppleTVAmpForTest } from "./appleTVAmpClient";

/**
 * The store's own half of the mute: it is the reading on the dial that flips, and
 * it has to flip back when the television refuses, or the light claims a mute
 * that is not there.
 */

/** The host's answer to `/api/appletv` and to every command the store sends. */
function stubHost(options: { failMute?: boolean } = {}) {
  const posts: Array<{ body: unknown; url: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
    if (init?.method === "POST") {
      posts.push({ body: JSON.parse(init.body ?? "{}"), url: String(url) });
      if (options.failMute && String(url).endsWith("/api/appletv/mute")) {
        return { ok: false, status: 502, json: async () => ({ error: "Home Assistant refused it" }) };
      }
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ lastPlay: null, playlists: ["Excellent", "Cool"] }) };
  }));
  return posts;
}

beforeEach(() => {
  resetAppleTVAmpForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the dial's mute", () => {
  it("sends the reading the dial is holding, not a level of its own", async () => {
    const posts = stubHost();
    const { result } = renderHook(() => useAppleTVAmp());
    await waitFor(() => expect(appleTVAmpState().loaded).toBe(true));

    act(() => result.current.setVolume(64));
    await act(async () => result.current.setMuted(true));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/appletv/mute");
    expect(posts[0].body).toEqual({ level: 64, muted: true });
    // The light and the reading agree with what was sent.
    expect(appleTVAmpState().muted).toBe(true);
  });

  it("flips the reading at once, and puts it back when the television refuses", async () => {
    stubHost({ failMute: true });
    const { result } = renderHook(() => useAppleTVAmp());
    await waitFor(() => expect(appleTVAmpState().loaded).toBe(true));

    act(() => result.current.setMuted(true));
    expect(appleTVAmpState().muted, "an immediate answer on the dial").toBe(true);

    await waitFor(() => expect(appleTVAmpState().muted).toBe(false));
    expect(result.current.error).toBe("Home Assistant refused it");
  });

  it("keeps the later tap when an earlier one fails after it", async () => {
    const pending: Array<(value: unknown) => void> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST" && String(url).endsWith("/api/appletv/mute")) {
        return new Promise((resolve) => pending.push(resolve));
      }
      if (init?.method === "POST") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({ lastPlay: null, playlists: ["Excellent"] }) };
    }));
    const { result } = renderHook(() => useAppleTVAmp());
    await waitFor(() => expect(appleTVAmpState().loaded).toBe(true));

    act(() => result.current.setMuted(true));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.setMuted(false));
    await waitFor(() => expect(pending).toHaveLength(2));

    // The first mute fails after the second tap: the dial must keep the second
    // tap's reading rather than snapping back to the state before it.
    await act(async () => {
      pending[0]({ ok: false, status: 502, json: async () => ({ error: "nope" }) });
    });

    expect(appleTVAmpState().muted).toBe(false);
    // And no error for a state the dial has already left: the later tap's
    // answer is the one that stands.
    expect(result.current.error).toBeNull();
  });
});
