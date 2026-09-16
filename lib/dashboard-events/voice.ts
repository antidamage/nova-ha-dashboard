// Voice speaking and transcript events, with the bounded process-local
// transcript copy.

import {
  MAX_VOICE_TRANSCRIPTS,
  VOICE_TRANSCRIPT_RETENTION_MS,
  type VoiceTranscriptEvent,
  type VoiceTranscriptKind,
  type VoiceTranscriptOutcome,
} from "../voice-transcript";
import { store } from "./store";
import { broadcast, sendClient, sseEvent } from "./transport";
import type { DashboardEventClient, VoiceSpeakingEvent } from "./types";

// Fan a nova-voice speaking event out to every connected client. The latest
// start is kept (with an expiry) so a client that connects mid-speech still
// raises its orb; the matching end clears it.
export function publishVoiceSpeaking(event: VoiceSpeakingEvent) {
  const now = Date.now();
  if (event.phase === "start") {
    const estimated = Number(event.estimatedDurationMs) || 0;
    store.voiceSpeaking = {
      json: JSON.stringify(event),
      turnId: event.turnId,
      receivedAt: now,
      // Generous bound: estimate can undershoot, and the client keeps its own
      // safety timeout anyway.
      expiresAt: now + (event.audibleOffsetMs ?? 0) + Math.max(estimated * 2, estimated + 10_000),
    };
  } else if (store.voiceSpeaking?.turnId === event.turnId) {
    store.voiceSpeaking = null;
  }
  broadcast(sseEvent("voice-speaking", JSON.stringify(event)));
}

// Keep a short process-local transcript so opening the Voice Agent panel after
// a turn still shows recent context. voice host remains the durable 24-hour
// transcript owner; the dashboard only fans out and displays this bounded copy.
export function publishVoiceTranscript(event: VoiceTranscriptEvent) {
  store.voiceTranscripts.push(event);
  const expiresBefore = Date.now() - VOICE_TRANSCRIPT_RETENTION_MS;
  store.voiceTranscripts = store.voiceTranscripts.filter(
    (entry) => new Date(entry.at).getTime() > expiresBefore,
  );
  if (store.voiceTranscripts.length > MAX_VOICE_TRANSCRIPTS) {
    store.voiceTranscripts.splice(0, store.voiceTranscripts.length - MAX_VOICE_TRANSCRIPTS);
  }
  broadcast(sseEvent("voice-transcript", JSON.stringify(event)));
}

// Upgrade an existing transcript line in place — the voice server posts this
// when a longer rendering of an already-displayed near-duplicate arrives, so
// the panel keeps one line per utterance instead of appending both.
export function replaceVoiceTranscript(
  replacesId: string,
  text: string,
  at: string,
  kind?: VoiceTranscriptKind,
  speakerName?: string,
  outcome?: VoiceTranscriptOutcome,
  decision?: string,
): VoiceTranscriptEvent | null {
  const entry = store.voiceTranscripts.find((item) => item.id === replacesId);
  if (!entry) {
    return null;
  }
  entry.text = text;
  entry.at = at;
  if (kind) {
    entry.kind = kind;
  }
  if (speakerName) {
    entry.speakerName = speakerName;
  }
  // The command tag arrives on this upgrade, so the outcome that qualifies it
  // has to arrive with it or the line reads as a plain successful command.
  if (outcome) {
    entry.outcome = outcome;
  }
  if (decision) {
    entry.decision = decision;
  }
  broadcast(sseEvent("voice-transcript-replaced", JSON.stringify(entry)));
  return { ...entry };
}

export function getVoiceTranscripts(): VoiceTranscriptEvent[] {
  const expiresBefore = Date.now() - VOICE_TRANSCRIPT_RETENTION_MS;
  store.voiceTranscripts = store.voiceTranscripts.filter(
    (entry) => new Date(entry.at).getTime() > expiresBefore,
  );
  return store.voiceTranscripts.map((entry) => ({ ...entry }));
}

export function clearVoiceTranscripts() {
  const event = { clearedAt: new Date().toISOString() };
  store.voiceTranscripts = [];
  broadcast(sseEvent("voice-transcript-cleared", JSON.stringify(event)));
  return event;
}

export function sendVoiceSpeakingSnapshot(client: DashboardEventClient) {
  const active = store.voiceSpeaking;
  if (!active) {
    return;
  }
  const now = Date.now();
  if (now >= active.expiresAt) {
    store.voiceSpeaking = null;
    return;
  }
  const replay = { ...(JSON.parse(active.json) as VoiceSpeakingEvent), elapsedMs: now - active.receivedAt };
  sendClient(client, sseEvent("voice-speaking", JSON.stringify(replay)));
}
