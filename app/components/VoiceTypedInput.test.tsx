import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceTypedInput } from "./VoiceTypedInput";

function input() {
  return screen.getByRole("textbox", { name: /Type a message/ }) as HTMLInputElement;
}

describe("VoiceTypedInput", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the trimmed line on Enter and clears the box", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceTypedInput />);

    fireEvent.change(input(), { target: { value: "  turn on the lounge lights " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(input().value).toBe(""));
    expect(fetchMock).toHaveBeenCalledWith("/api/voice/typed-turn", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "turn on the lounge lights" }),
    }));
  });

  it("never sends an empty line", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceTypedInput />);

    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the text and shows the error when the send fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "Voice server: HTTP 503" }), { status: 503 })));
    render(<VoiceTypedInput />);

    fireEvent.change(input(), { target: { value: "hello" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Voice server: HTTP 503");
    expect(input().value).toBe("hello");
  });
});
