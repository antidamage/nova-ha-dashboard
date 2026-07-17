import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOVA_AVATAR_THEME, NovaAvatarConfig } from "./NovaAvatarConfig";

vi.mock("next/navigation", () => ({
  usePathname: () => "/config",
}));

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NovaAvatarConfig", () => {
  it("does not fetch the legacy client config when embedded", async () => {
    const themeSet = {
      selection: "dark",
      themes: {
        dark: { avatar: DEFAULT_NOVA_AVATAR_THEME },
        light: { avatar: DEFAULT_NOVA_AVATAR_THEME },
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/theme") {
        return jsonResponse({ theme: themeSet });
      }
      if (url === "/api/watchface") {
        return jsonResponse({ watchface: {} });
      }
      if (url === "/api/nova-load") {
        return jsonResponse({ load: 0 });
      }
      if (url === "/api/orb-modules") {
        return jsonResponse({ modules: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NovaAvatarConfig
        embedded
        theme={DEFAULT_NOVA_AVATAR_THEME}
        onThemeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Status Orb Info")).toBeInTheDocument();
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/config/client")).toBe(false);
  });
});
