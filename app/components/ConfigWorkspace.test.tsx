import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigWorkspace } from "./ConfigWorkspace";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const config = {
  schemaVersion: 1,
  homeAssistant: {
    router: {
      name: "Router",
    },
  },
};

const secrets = {
  homeAssistant: { tokenConfigured: true, urlConfigured: true },
  iCloud: { appPasswordConfigured: false, enabled: false, usernameConfigured: false },
  mcp: { authRequired: true, bearerTokenConfigured: true },
  powershop: { emailConfigured: false, enabled: false, passwordConfigured: false },
};

const updateStatus = {
  channel: { repo: "nova/dashboard", branch: "main" },
  currentShortSha: null,
  deployedAt: null,
  latestShortSha: null,
  latestMessage: null,
  updateAvailable: false,
  autoUpdate: true,
  canRollback: false,
  previousSha: null,
  phase: "idle",
  phaseMessage: null,
  lastCheckedAt: null,
  checkOk: true,
  checkError: null,
  busy: false,
};

describe("ConfigWorkspace", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/config");
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads config, hides raw JSON, and shows secret setup status in the secrets accordion", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      json: async () => url === "/api/update" ? updateStatus : { config, secrets },
      ok: true,
    })));

    const { container } = render(<ConfigWorkspace />);

    expect(screen.queryByRole("button", { name: /^identity$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/choose what you want to configure/i)).not.toBeInTheDocument();
    expect(container.querySelector(".config-layout-categories-closed")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/config", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /^assistant/i }));
    expect(await screen.findByRole("button", { name: /^identity$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /validate/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /back to dashboard/i })[0]).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /cancel configuration/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /save configuration/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^system & data/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^secrets$/i }));

    expect(await screen.findByText("HA_TOKEN")).toBeInTheDocument();
  });

  it("triggers managed desktop sync when leaving config", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/desktop/sync") {
        return {
          json: async () => ({ ok: true, queued: true }),
          ok: true,
        };
      }
      return {
        json: async () => url === "/api/update" ? updateStatus : { config, secrets },
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConfigWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /^assistant/i }));
    await screen.findByRole("button", { name: /^identity$/i });
    fireEvent.click(screen.getAllByRole("button", { name: /back to dashboard/i })[0]);

    expect(routerPush).toHaveBeenCalledWith("/");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/desktop/sync", expect.objectContaining({ method: "POST" })));
  });

  it("imports config from a JSON file", async () => {
    const imported = { ...config, schemaVersion: 1 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/config" && init?.method === "PUT") {
        return {
          json: async () => ({ applied: true, config: imported, errors: [], ok: true }),
          ok: true,
        };
      }
      return {
        json: async () => url === "/api/update" ? updateStatus : { config, secrets },
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConfigWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /^system & data/i }));
    fireEvent.click(await screen.findByRole("button", { name: /config import\/export/i }));
    const file = new File([JSON.stringify(imported)], "dashboard-config.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Config import file"), { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT" })));
  });

  it("syncs the URL to the post-commit accordion state, not the pre-commit one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      json: async () => url === "/api/update" ? updateStatus : { config, secrets },
      ok: true,
    })));

    render(<ConfigWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /^assistant/i }));
    await screen.findByRole("button", { name: /^identity$/i });

    // The accordion-open/close events fire synchronously right after
    // setOpen(...), before React commits the state change that adds the
    // `.config-accordion-open` class the URL sync reads. Opening "Identity"
    // here should NOT be reflected in the URL in the same tick — only after
    // the deferred (rAF) read runs following commit + paint.
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));
    expect(window.location.pathname).not.toBe("/config/assistant/identity/");

    await waitFor(() => expect(window.location.pathname).toBe("/config/assistant/identity/"));
  });

  it("sends the browser to the front page, not authentik, once the session is gone", async () => {
    let sessionGone = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/auth/whoami") {
        return sessionGone
          ? { ok: false, status: 401, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ authenticated: true, username: "adeline" }) };
      }
      return {
        json: async () => url === "/api/update" ? updateStatus : { config, secrets },
        ok: true,
      };
    }));

    // jsdom doesn't implement real navigation; stand in a plain object so a
    // `.href` write is observable instead of logging "Not implemented".
    const originalLocation = window.location;
    // @ts-expect-error -- deliberately replacing the read-only global for the test
    delete window.location;
    // @ts-expect-error -- partial Location, only `.href` is exercised
    window.location = { ...originalLocation, href: originalLocation.href };

    try {
      render(<ConfigWorkspace />);
      fireEvent.click(screen.getByRole("button", { name: /^assistant/i }));
      await screen.findByRole("button", { name: /^identity$/i });

      sessionGone = true;
      // The idle/timer sweep is server-side and silent — the tab only learns
      // about it from the next probe. Tab-visibility regain is one trigger for
      // that probe; use it instead of waiting out the 60s poll interval.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(() => expect(window.location.href).toBe("/"));
    } finally {
      // @ts-expect-error -- restoring the read-only global after the test
      delete window.location;
      // @ts-expect-error -- Window["location"] only accepts an assignable href here
      window.location = originalLocation;
    }
  });
});
