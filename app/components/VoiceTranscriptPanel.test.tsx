import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: MessageEvent) => void>,
}));

vi.mock("./sharedDashboardEvents", () => ({
  subscribeToDashboardEvents: (handlers: Record<string, (event: MessageEvent) => void>) => {
    stream.handlers = handlers;
    return () => {};
  },
}));

import { VoiceTranscriptPanel } from "./VoiceTranscriptPanel";

describe("VoiceTranscriptPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stream.handlers = {};
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => ({
      json: async () => options?.method === "DELETE"
        ? { ok: true, clearedAt: "2026-07-17T00:44:00.000Z" }
        : {
            transcripts: [{
              id: "user-1",
              at: "2026-07-17T00:42:37.000Z",
              role: "user",
              text: "Turn it on",
            }],
          },
      ok: true,
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows dated user and custom agent-name lines without seconds", async () => {
    render(<VoiceTranscriptPanel />);

    const userLine = await screen.findByText(/User: Turn it on$/);
    expect(userLine.textContent).not.toContain(":37");

    act(() => {
      stream.handlers["voice-transcript"]?.(new MessageEvent("voice-transcript", {
        data: JSON.stringify({
          id: "assistant-1",
          at: "2026-07-17T00:43:12.000Z",
          role: "assistant",
          text: "Done",
          agentName: "Jarvis",
        }),
      }));
    });

    const assistantLine = await screen.findByText(/Jarvis: Done$/);
    expect(assistantLine.textContent).not.toContain(":12");
  });

  it("collapses the log and clears the shared history", async () => {
    render(<VoiceTranscriptPanel />);
    await screen.findByText(/User: Turn it on$/);

    const accordion = screen.getByRole("button", { name: /Live transcript/ });
    expect(accordion).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(accordion);
    expect(accordion).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("log")).not.toBeInTheDocument();

    fireEvent.click(accordion);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await screen.findByText(/Waiting for a voice turn/);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/voice/transcript",
      { method: "DELETE" },
    ));

    act(() => {
      stream.handlers["voice-transcript"]?.(new MessageEvent("voice-transcript", {
        data: JSON.stringify({
          id: "assistant-2",
          at: "2026-07-17T00:45:00.000Z",
          role: "assistant",
          text: "Back again",
          agentName: "Bandit",
        }),
      }));
    });
    await screen.findByText(/Bandit: Back again$/);

    act(() => {
      stream.handlers["voice-transcript-cleared"]?.(new MessageEvent("voice-transcript-cleared"));
    });
    expect(screen.queryByText(/Bandit: Back again$/)).not.toBeInTheDocument();
  });
});
