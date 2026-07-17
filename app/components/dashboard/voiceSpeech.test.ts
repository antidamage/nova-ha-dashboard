import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the handler map voiceSpeech registers on the shared SSE stream so
// tests can inject "voice-speaking" events without a real EventSource.
const stream = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: MessageEvent) => void>,
  unsubscribed: 0,
}));

vi.mock("../sharedDashboardEvents", () => ({
  subscribeToDashboardEvents: (map: Record<string, (event: MessageEvent) => void>) => {
    Object.assign(stream.handlers, map);
    return () => {
      stream.unsubscribed += 1;
    };
  },
}));

import {
  getVoiceSpeechPhase,
  sampleVoiceSpeechEnvelope,
  subscribeVoiceSpeechPhase,
} from "./voiceSpeech";

function dispatch(payload: Record<string, unknown>) {
  stream.handlers["voice-speaking"]?.(
    new MessageEvent("voice-speaking", { data: JSON.stringify(payload) }),
  );
}

describe("voiceSpeech", () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribe = subscribeVoiceSpeechPhase(() => {});
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    vi.useRealTimers();
  });

  it("is idle with a null envelope before any event", () => {
    expect(getVoiceSpeechPhase()).toBe("idle");
    expect(sampleVoiceSpeechEnvelope(performance.now(), 1.2)).toBeNull();
  });

  it("start with timings pulses on consonant onsets over a floor", () => {
    const t0 = performance.now();
    dispatch({
      phase: "start",
      turnId: "t1",
      timingsMs: [1000, 2000],
      estimatedDurationMs: 3000,
      audibleOffsetMs: 0,
    });
    expect(getVoiceSpeechPhase()).toBe("speaking");

    // Well after fade-in, between onsets: the floor holds the alert colour.
    const between = sampleVoiceSpeechEnvelope(t0 + 500, 1.2);
    expect(between).toBeGreaterThan(0.15);
    expect(between).toBeLessThan(0.35);

    // At an onset's attack peak the envelope approaches 1.
    const peak = sampleVoiceSpeechEnvelope(t0 + 1045, 1.2);
    expect(peak).toBeGreaterThan(0.9);

    // Long after the last kernel decays, back to the floor.
    const tail = sampleVoiceSpeechEnvelope(t0 + 2900, 1.2);
    expect(tail).toBeLessThan(0.35);
  });

  it("start without timings falls back to the gym-alert wave", () => {
    const t0 = performance.now();
    dispatch({ phase: "start", turnId: "t2", estimatedDurationMs: 2000, audibleOffsetMs: 0 });
    const early = sampleVoiceSpeechEnvelope(t0 + 5, 1.2);
    const later = sampleVoiceSpeechEnvelope(t0 + 400, 1.2);
    expect(early).not.toBeNull();
    expect(later).not.toBeNull();
    // Fade-in gates the first frames.
    expect(early as number).toBeLessThanOrEqual((5 / 140) + 0.01);
    expect(later as number).toBeGreaterThanOrEqual(0);
    expect(later as number).toBeLessThanOrEqual(1);
  });

  it("end fades out then returns to idle", () => {
    dispatch({
      phase: "start",
      turnId: "t3",
      timingsMs: [100],
      estimatedDurationMs: 1000,
      audibleOffsetMs: 0,
    });
    dispatch({ phase: "end", turnId: "t3", playedDurationMs: 0 });
    // fadeOutAt is "now": the ending phase lands on the next timer tick.
    vi.advanceTimersByTime(1);
    expect(getVoiceSpeechPhase()).toBe("ending");
    vi.advanceTimersByTime(2000);
    expect(getVoiceSpeechPhase()).toBe("idle");
    expect(sampleVoiceSpeechEnvelope(performance.now(), 1.2)).toBeNull();
  });

  it("ignores an end for a different turn", () => {
    dispatch({
      phase: "start",
      turnId: "t4",
      timingsMs: [100],
      estimatedDurationMs: 1000,
      audibleOffsetMs: 0,
    });
    dispatch({ phase: "end", turnId: "other", playedDurationMs: 0 });
    vi.advanceTimersByTime(1);
    expect(getVoiceSpeechPhase()).toBe("speaking");
  });

  it("safety timeout stands the orb down without an end event", () => {
    dispatch({
      phase: "start",
      turnId: "t5",
      timingsMs: [100],
      estimatedDurationMs: 1000,
      audibleOffsetMs: 0,
    });
    expect(getVoiceSpeechPhase()).toBe("speaking");
    // estimated * 1.5 < estimated + 8s slack, so the deadline is ~9s out.
    vi.advanceTimersByTime(20_000);
    expect(getVoiceSpeechPhase()).toBe("idle");
  });
});
