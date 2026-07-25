import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemActivityBlocker } from "./SystemActivityBlocker";

vi.mock("./AgentNameContext", () => ({
  useAgentName: () => "Nova",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * A Response whose body reports whether it was drained. An undrained body keeps
 * a shared-memory descriptor alive in the renderer until garbage collection —
 * at this loop's cadence that walked the kiosk into its 1024-descriptor limit
 * in under an hour and froze the screen.
 */
function trackedResponse(body: unknown, ok = true) {
  const state = { cancelled: false, read: false };
  const response = {
    ok,
    status: ok ? 200 : 503,
    body: {
      cancel: async () => {
        state.cancelled = true;
      },
    },
    json: async () => {
      state.read = true;
      return body;
    },
  } as unknown as Response;
  return { response, state };
}

describe("SystemActivityBlocker", () => {
  it("releases every polled response body", async () => {
    const health = trackedResponse({ ok: true });
    const status = trackedResponse({ busy: false, phaseAt: null });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/healthz") return health.response;
      if (url === "/api/update") return status.response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemActivityBlocker />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/healthz", expect.anything());
    }, { timeout: 6000 });

    // The health poll only reads `ok`, so its body must be cancelled outright.
    await waitFor(() => {
      expect(health.state.cancelled).toBe(true);
    }, { timeout: 6000 });

    // The update poll consumes its body instead, which releases it just as well.
    await waitFor(() => {
      expect(status.state.read).toBe(true);
    }, { timeout: 6000 });
  }, 20000);

  it("releases the body of a failed update poll, which it never reads", async () => {
    const health = trackedResponse({ ok: true });
    const status = trackedResponse({ error: "nope" }, false);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/healthz") return health.response;
      if (url === "/api/update") return status.response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemActivityBlocker />);

    await waitFor(() => {
      expect(status.state.cancelled).toBe(true);
    }, { timeout: 6000 });
    expect(status.state.read).toBe(false);
  }, 20000);
});
