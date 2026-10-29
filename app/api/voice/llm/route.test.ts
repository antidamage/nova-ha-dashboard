import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchVoiceHostLlmStatus = vi.fn();
const requestVoiceHostLlmSwitch = vi.fn();
vi.mock("../../../../lib/voice-host-settings", () => ({
  fetchVoiceHostLlmStatus: (...args: unknown[]) => fetchVoiceHostLlmStatus(...args),
  requestVoiceHostLlmSwitch: (...args: unknown[]) => requestVoiceHostLlmSwitch(...args),
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/voice/llm", { method: "POST", body: JSON.stringify(body) }));

describe("/api/voice/llm", () => {
  beforeEach(() => {
    fetchVoiceHostLlmStatus.mockReset();
    requestVoiceHostLlmSwitch.mockReset();
  });

  it("relays the status, or reports the voice server unreachable", async () => {
    fetchVoiceHostLlmStatus.mockResolvedValueOnce({ llm: "lfm3", llms: [] });
    expect(await (await GET()).json()).toEqual({ reachable: true, llm: "lfm3", llms: [] });
    fetchVoiceHostLlmStatus.mockResolvedValueOnce(null);
    expect(await (await GET()).json()).toEqual({ reachable: false });
  });

  it("rejects a body without a model id", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ llm: "  " })).status).toBe(400);
    expect(requestVoiceHostLlmSwitch).not.toHaveBeenCalled();
  });

  it("relays an accepted switch", async () => {
    requestVoiceHostLlmSwitch.mockResolvedValueOnce({ payload: { ok: true, llm: "bonsai", changed: true } });
    const response = await post({ llm: "bonsai" });
    expect(requestVoiceHostLlmSwitch).toHaveBeenCalledWith("bonsai");
    expect(await response.json()).toEqual({ ok: true, llm: "bonsai", changed: true });
  });

  it("passes a refusal through as 409 with the model's reason", async () => {
    requestVoiceHostLlmSwitch.mockResolvedValueOnce({ error: "HTTP 409", status: 409 });
    fetchVoiceHostLlmStatus.mockResolvedValueOnce({
      llm: "lfm3",
      llms: [{ id: "bonsai", label: "Bonsai 9B", available: false, unavailableReason: "Needs the GPU." }],
    });
    const response = await post({ llm: "bonsai" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Needs the GPU." });
  });

  it("reports other failures as 502", async () => {
    requestVoiceHostLlmSwitch.mockResolvedValueOnce({ error: "ECONNREFUSED" });
    expect((await post({ llm: "bonsai" })).status).toBe(502);
  });
});
