import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceLlmSection } from "./VoiceLlmSection";

const llms = [
  { id: "lfm3", label: "LFM3 1.7B", detail: "Small and fast.", available: true },
  { id: "bonsai", label: "Bonsai 9B", detail: "Larger.", available: true },
];

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("VoiceLlmSection", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists the voice server's models and marks the routed one active", async () => {
    stubFetch(() => json({ reachable: true, llm: "lfm3", llms }));
    render(<VoiceLlmSection />);
    expect(await screen.findByText("LFM3 1.7B · active")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Bonsai 9B/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("disables a model the voice server marks unavailable and shows why", async () => {
    stubFetch(() => json({
      reachable: true,
      llm: "lfm3",
      llms: [llms[0], { ...llms[1], available: false, unavailableReason: "Needs the whole GPU." }],
    }));
    render(<VoiceLlmSection />);
    expect(await screen.findByText("Needs the whole GPU.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Bonsai 9B/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches only after the confirm tap and follows the switch to ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status: Record<string, unknown> = { reachable: true, llm: "lfm3", llms };
    const fetchMock = stubFetch((_url, init) =>
      init?.method === "POST" ? json({ ok: true, llm: "bonsai", changed: true }) : json(status),
    );
    render(<VoiceLlmSection />);
    fireEvent.click(await screen.findByRole("radio", { name: /Bonsai 9B/ }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Switch to Bonsai 9B" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ llm: "bonsai" });
    });

    status = { ...status, switch: { target: "bonsai", phase: "starting" } };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(await screen.findByText(/Loading Bonsai 9B/)).toBeTruthy();

    status = { ...status, llm: "bonsai", switch: { target: "bonsai", phase: "ready" } };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(await screen.findByText("Switched to Bonsai 9B.")).toBeTruthy();
    expect(screen.getByText("Bonsai 9B · active")).toBeTruthy();
  });

  it("shows the refusal when the voice server will not switch", async () => {
    stubFetch((_url, init) =>
      init?.method === "POST"
        ? json({ error: "Bonsai 9B needs the whole GPU." }, 409)
        : json({ reachable: true, llm: "lfm3", llms }),
    );
    render(<VoiceLlmSection />);
    fireEvent.click(await screen.findByRole("radio", { name: /Bonsai 9B/ }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Bonsai 9B" }));
    expect(await screen.findByText("Bonsai 9B needs the whole GPU.")).toBeTruthy();
  });

  it("says so when the voice server is unreachable", async () => {
    stubFetch(() => json({ reachable: false }));
    render(<VoiceLlmSection />);
    expect(await screen.findByText("Voice server unavailable.")).toBeTruthy();
  });
});
