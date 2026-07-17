// Pure derivation for the config page's voice-server status readout. The
// dashboard makes one mTLS /health round trip per poll; this module turns the
// probe payload into display rows so the logic is testable without a network.

export type VoiceServerHealth = {
  ok?: boolean;
  provider?: { ok?: boolean };
  llm?: { ok?: boolean };
  audio?: {
    ok?: boolean;
    stt?: { ok?: boolean };
    tts?: { ok?: boolean };
    noiseSuppression?: { ok?: boolean };
    satellitePipelines?: number;
  };
};

export type VoiceServerStatusPayload = {
  host?: string;
  checkedAt?: string;
  reachable?: boolean;
  latencyMs?: number | null;
  error?: string;
  health?: VoiceServerHealth;
};

export type VoiceServerTone = "ok" | "warning" | "error";

export type VoiceServerServiceRow = { label: string; ok: boolean };

// Absent blocks read as faulted so a partial payload can never render as
// fully online. Noise suppression is a best-effort sidecar: the row only
// appears when the server reports it at all.
export function voiceServerServiceRows(health: VoiceServerHealth | undefined): VoiceServerServiceRow[] {
  if (!health) {
    return [];
  }
  const audio = health.audio ?? {};
  const rows: VoiceServerServiceRow[] = [
    { label: "Interpretation", ok: health.llm?.ok === true },
    { label: "Speech to text", ok: audio.stt?.ok === true },
    { label: "Text to speech", ok: audio.tts?.ok === true },
    { label: "Dashboard link", ok: health.provider?.ok === true },
  ];
  if (audio.noiseSuppression !== undefined) {
    rows.push({ label: "Noise suppression", ok: audio.noiseSuppression?.ok === true });
  }
  return rows;
}

export function voiceServerOverall(
  payload: VoiceServerStatusPayload | null,
  probeFailed: boolean,
): { text: string; tone: VoiceServerTone } {
  if (probeFailed) {
    return { text: "Status unavailable — the dashboard API is not responding", tone: "warning" };
  }
  if (!payload) {
    return { text: "Checking…", tone: "warning" };
  }
  if (payload.reachable !== true) {
    return {
      text: payload.error ? `Unreachable — ${payload.error}` : "Unreachable",
      tone: "error",
    };
  }
  const latency = typeof payload.latencyMs === "number" ? ` · ${Math.round(payload.latencyMs)} ms` : "";
  if (payload.health?.ok === true) {
    return { text: `Online${latency}`, tone: "ok" };
  }
  return { text: `Degraded — a voice service is reporting a fault${latency}`, tone: "warning" };
}
