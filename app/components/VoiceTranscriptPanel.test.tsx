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

import { AgentNameProvider } from "./AgentNameContext";
import { VoiceTranscriptPanel } from "./VoiceTranscriptPanel";

// A transcript entry renders as a two-line box: a decorated header <span>
// ("╭─[ USER ➤ <date/time> ➤ [KIND] ]"), a newline, and a "╰─ " body
// lead-in before the message text. RTL's default text matcher only looks at
// direct text-node children (see "text is broken up by multiple elements" in
// its own error message), so match on the full textContent of the <p> line.
function findTranscriptLine(pattern: RegExp) {
  return screen.findByText((_, element) =>
    element?.tagName.toLowerCase() === "p" && pattern.test(element.textContent ?? ""));
}

function queryTranscriptLine(pattern: RegExp) {
  return screen.queryByText((_, element) =>
    element?.tagName.toLowerCase() === "p" && pattern.test(element.textContent ?? ""));
}

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

  it("shows decorated user and custom agent-name lines without seconds", async () => {
    render(<VoiceTranscriptPanel />);

    const userLine = await findTranscriptLine(/╰─ Turn it on$/);
    expect(userLine.textContent).toMatch(/╭─\[ USER ➤ .* ➤ \[EXCHANGE\] \]\n/);
    expect(userLine.textContent).not.toContain(":37");
    expect(userLine).toHaveClass("voice-transcript-line--user");
    expect(userLine.querySelector(".voice-transcript-meta")?.textContent).toMatch(/USER/);
    expect(userLine.querySelector(".voice-transcript-meta")).toHaveClass("voice-transcript-meta--user");

    act(() => {
      stream.handlers["voice-transcript"]?.(new MessageEvent("voice-transcript", {
        data: JSON.stringify({
          id: "assistant-1",
          at: "2026-07-17T00:43:12.000Z",
          role: "assistant",
          text: "Done",
          agentName: "Jarvis",
          kind: "command",
        }),
      }));
    });

    // JARVIS (not the Nova fallback) guards the formatter call site passing
    // the live agent name in the new two-argument signature.
    const assistantLine = await findTranscriptLine(/╰─ Done$/);
    expect(assistantLine.textContent).toMatch(/╭─\[ JARVIS ➤ .* ➤ \[COMMAND\] \]\n/);
    // Newest-first: the later assistant turn renders above the earlier user turn.
    expect(assistantLine.compareDocumentPosition(userLine) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(assistantLine.textContent).not.toContain(":12");
    expect(assistantLine).toHaveClass("voice-transcript-line--assistant");
    expect(assistantLine.querySelector(".voice-transcript-meta")).toHaveClass("voice-transcript-meta--assistant");
  });

  it("applies a custom decoration template from the shared voice settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) =>
      url === "/api/voice"
        ? {
            ok: true,
            json: async () => ({
              voice: { agentName: "Nova", transcriptTemplate: "<%m%> %u%%a% @ %t%" },
            }),
          }
        : {
            ok: true,
            json: async () => ({
              transcripts: [{
                id: "user-1",
                at: "2026-07-17T00:42:37.000Z",
                role: "user",
                text: "Turn it on",
              }],
            }),
          }));

    render(
      <AgentNameProvider initialName="Nova">
        <VoiceTranscriptPanel />
      </AgentNameProvider>,
    );

    const userLine = await findTranscriptLine(/╰─ Turn it on$/);
    // The provider fetches /api/voice after mount, so the custom decoration
    // lands on a re-render; wait for it rather than asserting immediately.
    await waitFor(() =>
      expect(userLine.textContent).toMatch(/^<EXCHANGE> USER @ \d{1,2}:\d{2}(am|pm)\n/));
  });

  it("collapses the log and clears the shared history", async () => {
    render(<VoiceTranscriptPanel />);
    await findTranscriptLine(/╰─ Turn it on$/);

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
    const banditLine = await findTranscriptLine(/╰─ Back again$/);
    expect(banditLine.textContent).toContain("BANDIT");

    act(() => {
      stream.handlers["voice-transcript-cleared"]?.(new MessageEvent("voice-transcript-cleared"));
    });
    expect(queryTranscriptLine(/╰─ Back again$/)).not.toBeInTheDocument();
  });
});
