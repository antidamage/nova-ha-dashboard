import { describe, expect, it } from "vitest";
import { voiceServerOverall, voiceServerServiceRows } from "./voice-server-status";

const healthyPayload = {
  ok: true,
  provider: { ok: true },
  llm: { ok: true },
  audio: {
    ok: true,
    stt: { ok: true },
    tts: { ok: true },
    noiseSuppression: { ok: true },
    speakerRecognition: { ok: true, enabled: true },
    satellitePipelines: 2,
  },
};

describe("voiceServerServiceRows", () => {
  it("maps each voice service to a row when healthy", () => {
    const rows = voiceServerServiceRows(healthyPayload);
    expect(rows).toEqual([
      { label: "Interpretation", ok: true },
      { label: "Speech to text", ok: true },
      { label: "Text to speech", ok: true },
      { label: "Dashboard link", ok: true },
      { label: "Noise suppression", ok: true },
      { label: "Speaker recognition", ok: true },
    ]);
  });

  it("treats missing blocks as faulted rather than healthy", () => {
    const rows = voiceServerServiceRows({ ok: false });
    expect(rows.filter((row) => row.label !== "Noise suppression").every((row) => !row.ok)).toBe(true);
  });

  it("omits noise suppression when the sidecar is not reported", () => {
    const rows = voiceServerServiceRows({ ...healthyPayload, audio: { stt: { ok: true }, tts: { ok: true } } });
    expect(rows.map((row) => row.label)).not.toContain("Noise suppression");
  });

  it("returns no rows without a health payload", () => {
    expect(voiceServerServiceRows(undefined)).toEqual([]);
  });
});

describe("voiceServerOverall", () => {
  it("reports online with latency when the aggregate is ok", () => {
    const overall = voiceServerOverall({ reachable: true, latencyMs: 42, health: healthyPayload }, false);
    expect(overall).toEqual({ text: "Online · 42 ms", tone: "ok" });
  });

  it("reports degraded when reachable but a service faults", () => {
    const overall = voiceServerOverall(
      { reachable: true, latencyMs: 17, health: { ...healthyPayload, ok: false } },
      false,
    );
    expect(overall.tone).toBe("warning");
    expect(overall.text).toContain("Degraded");
  });

  it("reports unreachable with the probe error", () => {
    const overall = voiceServerOverall({ reachable: false, latencyMs: null, error: "ECONNREFUSED" }, false);
    expect(overall).toEqual({ text: "Unreachable — ECONNREFUSED", tone: "error" });
  });

  it("warns when the dashboard probe itself failed", () => {
    const overall = voiceServerOverall(null, true);
    expect(overall.tone).toBe("warning");
    expect(overall.text).toContain("dashboard API");
  });

  it("shows a pending state before the first probe lands", () => {
    expect(voiceServerOverall(null, false)).toEqual({ text: "Checking…", tone: "warning" });
  });
});
