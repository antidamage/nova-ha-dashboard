import { fetchVoiceHostJson, requestVoiceHostJson } from "./client";
import { HEALTH_PATH, SATELLITES_PATH, VOICES_PATH } from "./endpoints";
import type { VoiceHostCatalog, VoiceHostEngineStatus, VoiceHostEngineVoice, VoiceHostHealthProbe, VoiceHostJsonResult, VoiceHostSatelliteStatus } from "./types";

// The voice server's in-memory registry of every satellite that has connected
// since it started. `connected` can be optimistic: a half-open socket keeps a
// satellite listed as connected until the server notices, so treat this as
// advisory status, not proof of a working pipeline.
export async function fetchVoiceHostSatelliteRegistry(): Promise<VoiceHostSatelliteStatus[] | null> {
  const payload = await fetchVoiceHostJson(SATELLITES_PATH, "satellite registry");
  if (!payload || !Array.isArray((payload as { satellites?: unknown }).satellites)) {
    return null;
  }
  return (payload as { satellites: VoiceHostSatelliteStatus[] }).satellites
    .filter((satellite) => typeof satellite?.satelliteId === "string");
}

// voice host is authoritative for the voices and parameter ranges the deployed
// TTS/LLM stack supports; the dashboard's Voice Agent section populates its
// dropdowns from this instead of hard-coding model knowledge.
export async function fetchVoiceHostEngineStatus(): Promise<VoiceHostEngineStatus | null> {
  const payload = await fetchVoiceHostJson("/v1/engine", "engine status");
  const engine = (payload as { engine?: unknown } | null)?.engine;
  // Accept any non-empty engine id the server advertises rather than a
  // hardcoded pair, so a newly-registered engine (e.g. "trained") is usable
  // the moment the server knows about it — no dashboard release required.
  if (typeof engine !== "string" || !engine) {
    return null;
  }
  return payload as VoiceHostEngineStatus;
}

// Ask the voice server to swap the resident TTS engine. The server hands the
// swap to its root-side switcher and restarts itself, so a successful request
// is an acceptance, not a completion — callers follow progress by polling
// fetchVoiceHostEngineStatus() until the engine matches and its TTS is ready.
// The engine id is validated against the registry server-side (api.py's
// EngineSwitchRequest); the dashboard just passes through what the picker,
// itself populated from the server's own engine list, offered.
export async function requestVoiceHostEngineSwitch(
  engine: string,
): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson("/v1/engine", "engine switch", { method: "POST", body: { engine } });
}

export async function fetchVoiceHostCatalog(): Promise<VoiceHostCatalog | null> {
  const payload = await fetchVoiceHostJson(VOICES_PATH, "voices");
  if (payload && Array.isArray((payload as { voices?: unknown }).voices)) {
    return payload as VoiceHostCatalog;
  }
  return null;
}

// The registered voices for one engine's catalogue (Custom clones or Trained
// checkpoints), straight from that engine's own service registry -- the Voice
// Infrastructure catalogue panel renders this list. Engines with no
// catalogue (Classic) 404 server-side; treat that the same as "no voices".
export async function fetchVoiceHostEngineVoices(engineId: string): Promise<VoiceHostEngineVoice[] | null> {
  const payload = await fetchVoiceHostJson(
    `${VOICES_PATH}/${encodeURIComponent(engineId)}`,
    `${engineId} voices`,
  );
  if (!payload || !Array.isArray((payload as { voices?: unknown }).voices)) {
    return null;
  }
  return (payload as { voices: VoiceHostEngineVoice[] }).voices;
}

// Remove a registered voice from an engine's catalogue. Irreversible -- the
// engine's voice service deletes the voice's stored data outright.
export async function deleteVoiceHostEngineVoice(
  engineId: string,
  voiceId: string,
): Promise<VoiceHostJsonResult> {
  return requestVoiceHostJson(
    `${VOICES_PATH}/${encodeURIComponent(engineId)}/${encodeURIComponent(voiceId)}`,
    `${engineId} voice delete`,
    { method: "DELETE" },
  );
}

// One /health round trip against the voice server. `reachable` only means the
// server answered with a valid payload; the payload's own `ok` flags say
// whether each part of the stack is actually healthy.
export async function probeVoiceHostHealth(): Promise<VoiceHostHealthProbe> {
  const started = Date.now();
  const result = await requestVoiceHostJson(HEALTH_PATH, "health");
  if ("payload" in result) {
    return { reachable: true, latencyMs: Date.now() - started, health: result.payload };
  }
  return { reachable: false, latencyMs: null, error: result.error };
}
