// Pure derivation for the config page's voice-server status readout. The
// dashboard makes one mTLS /health round trip per poll; this module turns the
// probe payload into display rows so the logic is testable without a network.

// Warmth is reported separately from `ok` by the voice server, and stays
// separate here. "Up" and "quick to answer" are different questions, and the
// readout existed only for the first one — which is why a stack loading a
// trained voice's weights looked identical to a stack that was broken.
export type VoiceWarmthState =
  | "warm"
  | "warming"
  | "cold"
  | "training"
  | "disabled"
  | "unknown";

export type VoiceServerHealth = {
  ok?: boolean;
  provider?: { ok?: boolean };
  llm?: { ok?: boolean };
  audio?: {
    ok?: boolean;
    stt?: { ok?: boolean };
    tts?: { ok?: boolean };
    noiseSuppression?: { ok?: boolean };
    speakerRecognition?: { ok?: boolean; enabled?: boolean };
    satellitePipelines?: number;
  };
  warmth?: {
    ok?: boolean;
    state?: VoiceWarmthState;
    secondsSinceWarm?: number | null;
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
  if (audio.speakerRecognition?.enabled === true) {
    rows.push({ label: "Speaker recognition", ok: audio.speakerRecognition.ok === true });
  }
  return rows;
}

// One label per state, no explanation. The states are mutually exclusive and
// each says the whole thing: "Warming up" is not a fault, "Cold" is.
const WARMTH_LABELS: Record<VoiceWarmthState, { text: string; tone: VoiceServerTone }> = {
  warm: { text: "Warm", tone: "ok" },
  warming: { text: "Warming up", tone: "warning" },
  cold: { text: "Cold — not answering warm-up", tone: "error" },
  training: { text: "Training — voice is down", tone: "warning" },
  disabled: { text: "Warm-up disabled", tone: "warning" },
  unknown: { text: "Warmth unknown", tone: "warning" },
};

export function voiceServerWarmth(
  health: VoiceServerHealth | undefined,
): { text: string; tone: VoiceServerTone } | null {
  const state = health?.warmth?.state;
  if (!state) {
    // An older voice server that does not report warmth at all. Showing
    // "unknown" for it would be noise, so the row simply does not appear.
    return null;
  }
  return WARMTH_LABELS[state] ?? WARMTH_LABELS.unknown;
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
    // Every service is up. Warmth is then the thing worth saying, because it
    // is the difference between a wake word answered in a second and one
    // answered in twenty — and that gap, unexplained, is what made a slow
    // start indistinguishable from a broken one.
    const warmth = payload.health.warmth?.state;
    if (warmth === "training") {
      return { text: "Training — the voice stack is down for a run", tone: "warning" };
    }
    if (warmth === "warming") {
      return { text: `Online · warming up${latency}`, tone: "warning" };
    }
    if (warmth === "cold") {
      return { text: `Online · cold — warm-up is failing${latency}`, tone: "error" };
    }
    return { text: `Online${latency}`, tone: "ok" };
  }
  return { text: `Degraded — a voice service is reporting a fault${latency}`, tone: "warning" };
}
