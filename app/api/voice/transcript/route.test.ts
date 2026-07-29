import { describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";
import { endIridiumConversations } from "../../../../lib/iridium-voice-settings";

vi.mock("../../../../lib/iridium-voice-settings", () => ({
  endIridiumConversations: vi.fn(async () => ({ payload: { ok: true } })),
}));

describe("voice transcript API", () => {
  it("accepts an Iridium line and includes it in the bounded snapshot", async () => {
    const text = `Turn on the lounge light ${crypto.randomUUID()}`;
    // A recent timestamp: a hard-coded date silently ages past the 24-hour
    // retention window and the snapshot assertion starts failing.
    const response = await POST(new Request("http://nova.test/api/voice/transcript", {
      body: JSON.stringify({
        at: new Date(Date.now() - 60_000).toISOString(),
        role: "user",
        text,
        agentName: "Bandit",
        speakerName: "Adeline",
        roomId: "lounge",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(200);
    const posted = await response.json() as {
      transcript: { id: string; text: string; speakerName?: string };
    };
    expect(posted.transcript.id).toBeTruthy();
    expect(posted.transcript.text).toBe(text);
    expect(posted.transcript.speakerName).toBe("Adeline");

    const snapshot = await GET();
    const body = await snapshot.json() as { transcripts: Array<{ id: string; text: string }> };
    expect(body.transcripts).toContainEqual(expect.objectContaining({
      id: posted.transcript.id,
      text,
    }));
  });

  it("rejects an unknown role", async () => {
    const response = await POST(new Request("http://nova.test/api/voice/transcript", {
      body: JSON.stringify({ role: "system", text: "hidden prompt" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(400);
  });

  it("upgrades an existing user line with a newly recognized profile name", async () => {
    const id = crypto.randomUUID();
    const at = new Date(Date.now() - 30_000).toISOString();
    const initial = await POST(new Request("http://nova.test/api/voice/transcript", {
      body: JSON.stringify({ id, at, role: "user", text: "My name is Adeline" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));
    expect(initial.status).toBe(200);

    const replacement = await POST(new Request("http://nova.test/api/voice/transcript", {
      body: JSON.stringify({
        replacesId: id,
        at: new Date().toISOString(),
        role: "user",
        text: "My name is Adeline",
        speakerName: "Adeline",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({
      transcript: { id, speakerName: "Adeline" },
    });
  });

  it("clears the shared transcript snapshot and ends the live conversation", async () => {
    const cleared = await DELETE();
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      ok: true,
      clearedAt: expect.any(String),
      conversationsCleared: true,
    });
    // Wiping the panel while the assistant kept replying from the old frozen
    // context would misrepresent what it still remembers.
    expect(endIridiumConversations).toHaveBeenCalled();

    const snapshot = await GET();
    expect(await snapshot.json()).toEqual({ transcripts: [] });
  });

  it("still clears the panel when the voice server is unreachable", async () => {
    vi.mocked(endIridiumConversations).mockResolvedValueOnce({
      error: "voice server unreachable",
      status: 502,
    });

    const cleared = await DELETE();
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ok: true, conversationsCleared: false });

    const snapshot = await GET();
    expect(await snapshot.json()).toEqual({ transcripts: [] });
  });
});
