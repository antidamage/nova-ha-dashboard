import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NovaAvatar from "./NovaAvatar";
import type { ThemeStorageValue } from "./accentColor";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

let mockSpeechPhase: "idle" | "speaking" | "ending" = "idle";
vi.mock("./dashboard/voiceSpeech", async () => {
  const actual = await vi.importActual<typeof import("./dashboard/voiceSpeech")>("./dashboard/voiceSpeech");
  return {
    ...actual,
    useVoiceSpeechPhase: () => mockSpeechPhase,
  };
});

function themeWithGymColor(rgb: [number, number, number], opacity: number): ThemeStorageValue {
  return {
    selection: "dark",
    themes: {
      dark: {
        avatar: {
          gymNumberColor: { cursor: { x: 0.94, y: 0 }, intensity: 100, rgb },
          gymNumberOpacity: opacity,
        },
      },
      light: {
        avatar: {
          gymNumberColor: { cursor: { x: 0.1, y: 0 }, intensity: 100, rgb: [1, 2, 3] },
          gymNumberOpacity: 44,
        },
      },
    },
  } as unknown as ThemeStorageValue;
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  mockSpeechPhase = "idle";
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NovaAvatar", () => {
  it("renders the gym counter from the active variant avatar color and opacity", async () => {
    const initialTheme = themeWithGymColor([255, 0, 93], 94);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/theme") {
        return jsonResponse({ theme: initialTheme });
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

    render(<NovaAvatar forceVisible size={64} initialTheme={initialTheme} />);

    const host = screen.getByRole("group", { name: "Nova avatar" });
    await waitFor(() => {
      expect(host).toHaveAttribute("data-nova-avatar-gym-number-color", "255 0 93");
      expect(host).toHaveAttribute("data-nova-avatar-gym-number-opacity", "94");
      expect(host).toHaveAttribute("data-nova-avatar-variant", "dark");
    });
    expect(host).toHaveAttribute("data-nova-avatar-theme-ready", "true");
    expect(host.getAttribute("data-nova-avatar-theme-source")).toMatch(/^(initial-prop|api-theme)$/);
    expect(host.querySelector(".nova-avatar-gym-counter")).toHaveStyle("color: rgba(255, 0, 93, 0.94)");
  });

  it("unmounts entirely and never polls its endpoints on a lite-mode device", async () => {
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "lite");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    render(<NovaAvatar size={64} />);

    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "Nova avatar" })).toBeNull();
    });
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).not.toContain("/api/nova-load");
    expect(requestedUrls).not.toContain("/api/watchface");
  });

  it("polls nova-load at a cadence a long-lived kiosk page can sustain", async () => {
    // A 100ms cadence walked the renderer's descriptor limit in under an hour
    // and froze the kiosk. Ten seconds of wall clock must stay in single digits.
    const initialTheme = themeWithGymColor([255, 0, 93], 94);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/theme") return jsonResponse({ theme: initialTheme });
      if (url === "/api/watchface") return jsonResponse({ watchface: {} });
      if (url === "/api/nova-load") return jsonResponse({ load: 0 });
      if (url === "/api/orb-modules") return jsonResponse({ modules: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const countLoadCalls = () =>
      fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/nova-load").length;

    // Timers must be faked before render, or the poll interval is created
    // against the real clock and advancing proves nothing.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<NovaAvatar forceVisible size={64} initialTheme={initialTheme} />);
      await screen.findByRole("group", { name: "Nova avatar" });

      const before = countLoadCalls();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(countLoadCalls() - before).toBeLessThanOrEqual(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fades the gym counter out while speech is active and back in once idle", async () => {
    const initialTheme = themeWithGymColor([255, 0, 93], 94);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/theme") return jsonResponse({ theme: initialTheme });
      if (url === "/api/watchface") return jsonResponse({ watchface: {} });
      if (url === "/api/nova-load") return jsonResponse({ load: 0 });
      if (url === "/api/orb-modules") return jsonResponse({ modules: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mockSpeechPhase = "speaking";
    const { rerender } = render(<NovaAvatar size={64} initialTheme={initialTheme} />);

    const host = await screen.findByRole("group", { name: "Nova avatar" });
    await waitFor(() => {
      expect(host.querySelector(".nova-avatar-gym-counter")).toHaveClass("nova-avatar-gym-counter-speech-hidden");
      expect(host.querySelector(".nova-avatar-voice-glow")).toHaveClass("is-visible");
      expect(host).toHaveAttribute("data-nova-avatar-voice", "active");
    });

    mockSpeechPhase = "idle";
    rerender(<NovaAvatar size={64} initialTheme={initialTheme} />);

    await waitFor(() => {
      expect(host.querySelector(".nova-avatar-gym-counter")).not.toHaveClass("nova-avatar-gym-counter-speech-hidden");
      expect(host.querySelector(".nova-avatar-voice-glow")).not.toHaveClass("is-visible");
      expect(host).not.toHaveAttribute("data-nova-avatar-voice");
    });
  });

  it("still renders forceVisible previews on a lite-mode device", async () => {
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "lite");
    const initialTheme = themeWithGymColor([255, 0, 93], 94);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    render(<NovaAvatar forceVisible size={64} initialTheme={initialTheme} />);

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Nova avatar" })).toBeInTheDocument();
    });
  });
});
