import { randomUUID } from "node:crypto";
import { isReminderIconId, REMINDER_ICON_IDS } from "../reminder-glyph";
import { requestVoiceHostJson } from "./client";
import { CLASSIFY_ICON_PATH } from "./endpoints";
import type { VoiceHostJsonResult, VoiceUtteranceResult } from "./types";

// Ask the voice host to pick a reminder sigil for a reminder name.
//
// The LLM itself (llama-server) is bound to 127.0.0.1 on voiceHost and firewalled
// to localhost, so the orchestrator proxies for us -- see nova_voice.api
// /v1/classify-icon. `icons` is an allow-list; the server validates its own
// model's answer against it and returns null rather than an id we could not
// render, and we re-check here because a stale voice build could still be
// running an older, laxer handler.
export async function classifyReminderIcon(
  name: string,
  timeoutMs: number,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const result = await requestVoiceHostJson(CLASSIFY_ICON_PATH, "reminder icon classification", {
    method: "POST",
    body: { name: trimmed, icons: REMINDER_ICON_IDS },
    timeoutMs,
  });

  if (!("payload" in result)) {
    return null;
  }

  const icon = (result.payload as { icon?: unknown } | null)?.icon;
  return isReminderIconId(icon) ? icon : null;
}

/**
 * Put a text utterance through the voice agent and get its result back.
 *
 * This is the same `POST /v1/utterances` an audio satellite uses; handling an
 * utterance does not speak, because TTS is driven by the audio runtime from
 * `response_text` (see the existing non-speaking `dashboard-preview` caller in
 * nova-voice's service.py). A text channel therefore needs nothing special.
 *
 * `dryRun` plans and authorises the turn for real and withholds only the final
 * household mutation, returning each withheld call verbatim. That is what lets
 * a text channel ask "would this change anything?" without guessing.
 */
export async function sendVoiceHostUtterance(options: {
  transcript: string;
  satelliteId: string;
  roomId: string;
  dryRun: boolean;
  timeoutMs?: number;
}): Promise<{ result: VoiceUtteranceResult } | { error: string; status?: number }> {
  const now = new Date().toISOString();
  const response = await requestVoiceHostJson("/v1/utterances", "utterance", {
    method: "POST",
    body: {
      id: randomUUID(),
      satellite_id: options.satelliteId,
      room_id: options.roomId,
      started_at: now,
      ended_at: now,
      transcript: options.transcript,
      // A typed message is not a wake-word capture; it is addressed by the fact
      // that it was sent at all.
      wake_detected: true,
      dry_run: options.dryRun,
    },
    timeoutMs: options.timeoutMs,
  });

  if (!("payload" in response)) {
    return { error: response.error, status: response.status };
  }
  return { result: (response.payload ?? {}) as VoiceUtteranceResult };
}

// Clearing the transcript log clears the assistant's working context too: the
// visible record and what the model is still reasoning from are one thing to
// the person pressing clear. Best-effort — a voice server that is unreachable
// must never block the panel from clearing.
export async function endVoiceHostConversations(): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson("/v1/conversations", "conversation context clear", {
    method: "DELETE",
  });
}
