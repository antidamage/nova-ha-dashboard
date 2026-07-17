import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./route";

describe("voice transcript API", () => {
  it("accepts an Iridium line and includes it in the bounded snapshot", async () => {
    const text = `Turn on the lounge light ${crypto.randomUUID()}`;
    const response = await POST(new Request("http://nova.test/api/voice/transcript", {
      body: JSON.stringify({
        at: "2026-07-17T00:42:37Z",
        role: "user",
        text,
        agentName: "Bandit",
        roomId: "lounge",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(200);
    const posted = await response.json() as { transcript: { id: string; text: string } };
    expect(posted.transcript.id).toBeTruthy();
    expect(posted.transcript.text).toBe(text);

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

  it("clears the shared transcript snapshot", async () => {
    const cleared = await DELETE();
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ok: true, clearedAt: expect.any(String) });

    const snapshot = await GET();
    expect(await snapshot.json()).toEqual({ transcripts: [] });
  });
});
