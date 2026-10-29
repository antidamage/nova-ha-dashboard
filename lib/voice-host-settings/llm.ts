import { fetchVoiceHostJson, requestVoiceHostJson } from "./client";
import type { VoiceHostJsonResult } from "./types";

// One entry of the voice server's interpretation-model registry
// (nova_voice.llm_models dashboard_llms_manifest()): what the picker renders,
// and whether the model can run beside the resident TTS engine.
export type VoiceHostLlmDescriptor = {
  id: string;
  label: string;
  detail?: string;
  available: boolean;
  unavailableReason?: string;
};

// GET /v1/llm: the model the voice agent is routed to, the registry, and the
// root-side switcher's progress (absent until a switch has ever run).
export type VoiceHostLlmStatus = {
  llm: string | null;
  llms: VoiceHostLlmDescriptor[];
  switch?: { target: string; phase: string; error?: string; updatedAt?: string };
};

export async function fetchVoiceHostLlmStatus(): Promise<VoiceHostLlmStatus | null> {
  const payload = await fetchVoiceHostJson("/v1/llm", "llm status");
  if (!payload || !Array.isArray((payload as { llms?: unknown }).llms)) {
    return null;
  }
  return payload as VoiceHostLlmStatus;
}

// Ask the voice server to start a model, route to it and stop the others.
// Acceptance, not completion: callers poll fetchVoiceHostLlmStatus().
export async function requestVoiceHostLlmSwitch(llm: string): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson("/v1/llm", "llm switch", { method: "POST", body: { llm } });
}
