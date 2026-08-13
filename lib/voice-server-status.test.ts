import { describe, expect, it } from "vitest";
import {
  voiceServerOverall,
  voiceServerServiceRows,
  voiceServerWarmth,
} from "./voice-server-status";

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

describe("voiceServerWarmth", () => {
  it("shows a warm stack as healthy", () => {
    expect(voiceServerWarmth({ ...healthyPayload, warmth: { ok: true, state: "warm" } })).toEqual({
      text: "Warm",
      tone: "ok",
    });
  });

  it("separates a stack that is starting from one that is broken", () => {
    // The whole point of the readout: these two used to look identical from
    // the kitchen, and one of them needs no action at all.
    expect(voiceServerWarmth({ warmth: { state: "warming" } })?.tone).toBe("warning");
    expect(voiceServerWarmth({ warmth: { state: "cold" } })?.tone).toBe("error");
  });

  it("does not colour a training handover as a fault", () => {
    const warmth = voiceServerWarmth({ warmth: { ok: true, state: "training" } });
    expect(warmth?.tone).toBe("warning");
    expect(warmth?.text).toContain("Training");
  });

  it("shows nothing for a voice server that does not report warmth", () => {
    expect(voiceServerWarmth(healthyPayload)).toBeNull();
    expect(voiceServerWarmth(undefined)).toBeNull();
  });
});

describe("voiceServerOverall warmth", () => {
  const reachable = (state?: string) => ({
    reachable: true,
    latencyMs: 12,
    health: { ...healthyPayload, ...(state ? { warmth: { state } } : {}) },
  });

  it("says online and nothing more when the stack is warm", () => {
    expect(voiceServerOverall(reachable("warm") as never, false)).toEqual({
      text: "Online · 12 ms",
      tone: "ok",
    });
  });

  it("says it is warming rather than leaving a slow reply unexplained", () => {
    const overall = voiceServerOverall(reachable("warming") as never, false);
    expect(overall.tone).toBe("warning");
    expect(overall.text).toContain("warming up");
  });

  it("escalates a stack whose warm-up keeps failing", () => {
    const overall = voiceServerOverall(reachable("cold") as never, false);
    expect(overall.tone).toBe("error");
    expect(overall.text).toContain("cold");
  });

  it("names training as the reason the voice is down", () => {
    const overall = voiceServerOverall(reachable("training") as never, false);
    expect(overall.text).toContain("Training");
  });

  it("still reads as plain online against a server with no warmth field", () => {
    expect(voiceServerOverall(reachable() as never, false).tone).toBe("ok");
  });
});
