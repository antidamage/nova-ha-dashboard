"use client";

// Shared client-side state for the voice agent's speaking orb.
//
// When nova-voice starts speaking a response it POSTs to /api/voice/speaking,
// which the dashboard server fans out to every connected browser as a
// "voice-speaking" SSE event — the same low-latency stream the rest of the
// dashboard already holds open. This module turns those events into:
//
//   - a coarse PHASE every React consumer can subscribe to
//     ("idle" → "speaking" → "ending" → "idle") driving the orb's migration
//     to the viewport centre and back, and
//   - a per-frame ENVELOPE (0..1) the orb's canvas loop samples to pulse the
//     gym-alert colour in time with the consonants of the spoken text.
//
// The consonant onsets arrive as millisecond offsets from *audible* speech
// start (the server adds an audibleOffsetMs estimate covering TTS first-chunk
// latency + the WiFi hop + the satellite jitter buffer). When no timings are
// available the envelope falls back to the module's own gym-alert wave, gated
// by a fast fade-in/fade-out — exactly the requested degraded behaviour.

import { useSyncExternalStore } from "react";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";

export type VoiceSpeechPhase = "idle" | "speaking" | "ending";

type VoiceSpeakingPayload = {
  phase?: string;
  turnId?: string;
  timingsMs?: number[];
  estimatedDurationMs?: number;
  audibleOffsetMs?: number;
  playedDurationMs?: number;
  elapsedMs?: number;
};

type SpeechSession = {
  turnId: string;
  /** performance.now() timestamp of the start event's arrival. */
  startedAt: number;
  /** performance.now() timestamp audio is expected to become audible. */
  audibleAt: number;
  /** Sorted consonant onsets in ms relative to audibleAt; null = fallback mode. */
  timingsMs: number[] | null;
  estimatedDurationMs: number;
  /** Set once the end event (or safety timeout) fires. */
  fadeOutAt: number | null;
  /** Hard deadline after which the session force-ends without an end event. */
  safetyDeadline: number;
};

const FADE_IN_MS = 140;
const FADE_OUT_MS = 420;
// How long after fade-out completes the orb keeps "ending" (return-migration
// window) before consumers may unmount speech-only orbs.
const RETURN_MS = 450;
// Consonant pulse kernel: fast attack, natural decay.
const PULSE_ATTACK_MS = 45;
const PULSE_DECAY_TAU_MS = 110;
// While speaking, the alert colour never fully drops between consonants.
const PULSE_FLOOR = 0.22;
// Without an end event the orb must still stand down eventually.
const SAFETY_SLACK_MS = 8_000;

let session: SpeechSession | null = null;
let phase: VoiceSpeechPhase = "idle";
let phaseTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

type PhaseListener = (phase: VoiceSpeechPhase) => void;
const listeners = new Set<PhaseListener>();
let unsubscribeStream: (() => void) | null = null;

function setPhase(next: VoiceSpeechPhase) {
  if (phase === next) {
    return;
  }
  phase = next;
  for (const listener of Array.from(listeners)) {
    listener(next);
  }
}

function clearTimers() {
  if (phaseTimer !== null) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

function beginEnding(fadeOutAt: number) {
  if (!session || session.fadeOutAt !== null) {
    return;
  }
  session.fadeOutAt = fadeOutAt;
  const now = performance.now();
  const untilFade = Math.max(0, fadeOutAt - now);
  clearTimers();
  phaseTimer = setTimeout(() => {
    setPhase("ending");
    phaseTimer = setTimeout(() => {
      session = null;
      setPhase("idle");
    }, FADE_OUT_MS + RETURN_MS);
  }, untilFade);
}

function handleStart(payload: VoiceSpeakingPayload) {
  const turnId = typeof payload.turnId === "string" ? payload.turnId : "";
  if (!turnId) {
    return;
  }
  const now = performance.now();
  // elapsedMs is nonzero only when the server replays an in-progress speech
  // to a freshly connected client.
  const elapsed = Number(payload.elapsedMs) || 0;
  const audibleOffset = Number(payload.audibleOffsetMs) || 0;
  const estimated = Math.max(300, Number(payload.estimatedDurationMs) || 0);
  const timings = Array.isArray(payload.timingsMs)
    ? payload.timingsMs.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
    : [];
  clearTimers();
  session = {
    turnId,
    startedAt: now - elapsed,
    audibleAt: now - elapsed + audibleOffset,
    timingsMs: timings.length ? timings : null,
    estimatedDurationMs: estimated,
    fadeOutAt: null,
    safetyDeadline: now - elapsed + audibleOffset + Math.max(estimated * 1.5, estimated + SAFETY_SLACK_MS),
  };
  setPhase("speaking");
  safetyTimer = setTimeout(() => {
    if (session && session.fadeOutAt === null) {
      beginEnding(performance.now());
    }
  }, Math.max(0, session.safetyDeadline - now));
}

function handleEnd(payload: VoiceSpeakingPayload) {
  if (!session || (payload.turnId && payload.turnId !== session.turnId)) {
    return;
  }
  const now = performance.now();
  const played = Number(payload.playedDurationMs) || 0;
  // Delivery to the satellite finishes ahead of playback: hold the orb until
  // the announced audio has actually had time to leave the speaker.
  beginEnding(Math.max(now, Math.min(session.audibleAt + played, session.safetyDeadline)));
}

function handleEvent(event: MessageEvent) {
  let payload: VoiceSpeakingPayload;
  try {
    payload = JSON.parse(event.data) as VoiceSpeakingPayload;
  } catch {
    return;
  }
  if (payload.phase === "start") {
    handleStart(payload);
  } else if (payload.phase === "end") {
    handleEnd(payload);
  }
}

/**
 * Subscribe to speech phase changes. The first subscriber attaches the shared
 * SSE stream; the last one detaches it. Returns an unsubscribe function.
 */
export function subscribeVoiceSpeechPhase(listener: PhaseListener): () => void {
  listeners.add(listener);
  if (!unsubscribeStream) {
    unsubscribeStream = subscribeToDashboardEvents({ "voice-speaking": handleEvent });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeStream) {
      unsubscribeStream();
      unsubscribeStream = null;
      clearTimers();
      session = null;
      phase = "idle";
    }
  };
}

export function getVoiceSpeechPhase(): VoiceSpeechPhase {
  return phase;
}

// Module-level so useSyncExternalStore sees a stable subscribe identity and
// never churns the underlying SSE subscription on re-renders.
function subscribePhaseStore(onStoreChange: () => void): () => void {
  return subscribeVoiceSpeechPhase(onStoreChange);
}

function getServerPhase(): VoiceSpeechPhase {
  return "idle";
}

/** React subscription to the speech phase (SSR always sees "idle"). */
export function useVoiceSpeechPhase(): VoiceSpeechPhase {
  return useSyncExternalStore(subscribePhaseStore, getVoiceSpeechPhase, getServerPhase);
}

/** Raised-cosine 0..1 wave — the same shape the orb renderer uses for gym alerts. */
function alertWave(nowMs: number, periodSeconds: number): number {
  const period = Math.max(0.05, periodSeconds) * 1000;
  return (1 - Math.cos((nowMs / period) * Math.PI * 2)) / 2;
}

function pulseKernel(deltaMs: number): number {
  if (deltaMs < 0 || deltaMs > PULSE_ATTACK_MS + PULSE_DECAY_TAU_MS * 5) {
    return 0;
  }
  if (deltaMs <= PULSE_ATTACK_MS) {
    return deltaMs / PULSE_ATTACK_MS;
  }
  return Math.exp(-(deltaMs - PULSE_ATTACK_MS) / PULSE_DECAY_TAU_MS);
}

/**
 * Sample the speech envelope for one animation frame. Returns null when no
 * speech session is active (the orb should render gym-alert state as usual);
 * otherwise a 0..1 value that drives the alert-colour pulse.
 *
 * `alertPulsePeriodSeconds` is the active module's gym-alert period, used by
 * the no-timings fallback so the degraded mode is literally the gym alert
 * animation faded in and out.
 */
export function sampleVoiceSpeechEnvelope(
  nowPerfMs: number,
  alertPulsePeriodSeconds: number,
): number | null {
  const active = session;
  if (!active) {
    return null;
  }

  const fadeIn = Math.min(1, Math.max(0, (nowPerfMs - active.startedAt) / FADE_IN_MS));
  let fadeOut = 1;
  if (active.fadeOutAt !== null && nowPerfMs >= active.fadeOutAt) {
    fadeOut = Math.max(0, 1 - (nowPerfMs - active.fadeOutAt) / FADE_OUT_MS);
  }
  const gate = fadeIn * fadeOut;
  if (gate <= 0) {
    return 0;
  }

  const timings = active.timingsMs;
  if (!timings) {
    return gate * alertWave(nowPerfMs, alertPulsePeriodSeconds);
  }

  const speechMs = nowPerfMs - active.audibleAt;
  // Sum the few kernels whose window covers this frame. Onsets are sorted, so
  // scan a small neighbourhood found by binary search instead of the whole list.
  const windowStart = speechMs - (PULSE_ATTACK_MS + PULSE_DECAY_TAU_MS * 5);
  let lo = 0;
  let hi = timings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid] < windowStart) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  let pulse = 0;
  for (let i = lo; i < timings.length && timings[i] <= speechMs; i += 1) {
    pulse += pulseKernel(speechMs - timings[i]);
  }
  pulse = Math.min(1, pulse);
  return gate * (PULSE_FLOOR + (1 - PULSE_FLOOR) * pulse);
}
