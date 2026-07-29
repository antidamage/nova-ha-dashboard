import { readFile } from "fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { isReminderIconId, REMINDER_ICON_IDS } from "./reminder-glyph";
import type { VoiceEngineCapabilities } from "./voice-settings";

export type IridiumVoiceRefreshResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number };

// Deployments set NOVA_VOICE_IRIDIUM_URL (see PRIVATEREF.md#1.3); this
// fallback is a generic placeholder for unconfigured installs.
const DEFAULT_IRIDIUM_URL = "https://voice-server.local:8766";
const REFRESH_PATH = "/v1/settings/refresh";
const VOICES_PATH = "/v1/voices";
const PREVIEW_PATH = "/v1/voices/preview";
const HEALTH_PATH = "/health";
// The monitor snapshot is the server's live satellite registry. A high cursor
// skips the event backlog; only the `satellites` array matters here.
const SATELLITES_PATH = "/v1/monitor/events?after=1000000000";
const SPEAKER_PROFILES_PATH = "/v1/speaker-profiles";
const CLASSIFY_ICON_PATH = "/v1/classify-icon";
const REQUEST_TIMEOUT_MS = 5_000;
// Synthesis is slower than a plain status round trip (model inference, and a
// cold voice can take a couple of seconds), so the preview gets its own budget.
const PREVIEW_TIMEOUT_MS = 30_000;
// Building/uploading a voice can be slow -- ffmpeg over sample clips (Custom)
// or a multi-file checkpoint bundle (Trained) -- over a home network.
const ENGINE_VOICE_BUILD_TIMEOUT_MS = 60_000;

// One entry of the server's engine registry manifest (nova_voice.tts_engines
// dashboard_engines_manifest()) — id/label plus what voice controls to render
// for it. The dashboard renders off this array (and its capabilities) instead
// of a hardcoded classic/custom pair, so a new engine the server advertises
// needs no dashboard code change to appear in the picker.
export type IridiumEngineDescriptor = {
  id: string;
  label: string;
  capabilities?: VoiceEngineCapabilities;
};

export type IridiumVoiceCatalog = {
  voices: { value: string; label: string; detail: string }[];
  languages: string[];
  accents: string[];
  emotions: string[];
  ranges: Record<string, { min: number; max: number; step: number; default: number }>;
  current?: unknown;
  /** Id of the resident TTS engine module, from the server's engine registry. */
  engine?: string;
  engines?: IridiumEngineDescriptor[];
  /** The resident engine's own voice catalogue (custom clones / trained checkpoints), if it has one. */
  engineVoices?: { id: string; name?: string; language?: string }[];
};

// GET /v1/engine: the resident engine plus the root-side switcher's progress
// file, which outlives orchestrator restarts so the dashboard can follow a
// switch across the downtime it intentionally causes.
export type IridiumEngineStatus = {
  engine: string;
  engines?: IridiumEngineDescriptor[];
  switch?: {
    target?: string;
    phase?: "preparing" | "restarting" | "warming" | "ready" | "failed";
    updatedAt?: string;
    error?: string;
  };
  tts?: { ok?: boolean; ready?: boolean; error?: string; speaker?: string };
};

function iridiumUrl(path: string) {
  const baseUrl = process.env.NOVA_VOICE_IRIDIUM_URL?.trim() || DEFAULT_IRIDIUM_URL;
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

// Voice training runs on its own port, served by a process that holds no models
// and is not stopped when a training run takes the GPU. Pointing training at the
// voice API meant a run switched off its own control surface: progress froze at
// the last successful poll and Stop returned a connection error while the run
// carried on. Derived from the voice URL so a deployment configures one host.
const TRAINING_PORT = process.env.NOVA_VOICE_TRAINING_PORT?.trim() || "8097";

function trainingUrl(path: string) {
  const base = new URL(
    "/",
    (process.env.NOVA_VOICE_IRIDIUM_URL?.trim() || DEFAULT_IRIDIUM_URL).replace(/\/$/, "") + "/",
  );
  base.port = TRAINING_PORT;
  return new URL(path, base);
}

function refreshUrl() {
  return iridiumUrl(REFRESH_PATH);
}

async function tlsIdentity() {
  const root = path.join(process.cwd(), "data", "nova-voice-tls");
  const [ca, cert, key] = await Promise.all([
    readFile(path.join(root, "ca.crt")),
    readFile(path.join(root, "client.crt")),
    readFile(path.join(root, "client.key")),
  ]);
  return { ca, cert, key };
}

/** The mTLS client identity used to reach Iridium (ca/cert/key buffers). */
export async function readVoiceTlsIdentity() {
  return tlsIdentity();
}

/** The configured Iridium base URL (e.g. https://voice-server.local:8766). */
export function iridiumBaseUrl(): string {
  return process.env.NOVA_VOICE_IRIDIUM_URL?.trim() || DEFAULT_IRIDIUM_URL;
}

export async function triggerIridiumVoiceSettingsRefresh(): Promise<IridiumVoiceRefreshResult> {
  let url: URL;
  try {
    url = refreshUrl();
  } catch (error) {
    console.error("[nova-dashboard] invalid Iridium voice URL", error);
    return { ok: false, error: "Iridium voice refresh URL is invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Iridium voice refresh URL must use HTTP or HTTPS" };
  }

  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] Iridium voice TLS identity is unavailable", error);
      return { ok: false, error: "Iridium voice refresh TLS identity is unavailable" };
    }
  }

  return await new Promise<IridiumVoiceRefreshResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(
      url,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Length": "0" },
        timeout: REQUEST_TIMEOUT_MS,
        ...(identity ?? {}),
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          const status = response.statusCode ?? 502;
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status });
            return;
          }
          console.error(`[nova-dashboard] Iridium voice refresh returned HTTP ${status}`);
          resolve({ ok: false, error: "Iridium rejected the voice settings refresh", status });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error("[nova-dashboard] Iridium voice refresh request failed", error);
      resolve({ ok: false, error: "Iridium voice refresh request failed" });
    });
    request.end();
  });
}

export type IridiumVoicePreviewResult =
  | { ok: true; audio: Buffer; contentType: string }
  | { ok: false; error: string; status?: number };

// POST a short synthesis request to Iridium and hand back the raw WAV bytes.
// The personality Test button plays this in the browser; the dashboard makes
// the mTLS round trip so no browser ever needs the voice-server TLS identity.
export async function fetchIridiumVoicePreview(text?: string): Promise<IridiumVoicePreviewResult> {
  let url: URL;
  try {
    url = iridiumUrl(PREVIEW_PATH);
  } catch (error) {
    console.error("[nova-dashboard] invalid Iridium voice preview URL", error);
    return { ok: false, error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] Iridium voice preview TLS identity is unavailable", error);
      return { ok: false, error: "voice server TLS identity is unavailable" };
    }
  }
  const body = JSON.stringify({ text: typeof text === "string" ? text : null });
  return await new Promise<IridiumVoicePreviewResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(
      url,
      {
        method: "POST",
        headers: {
          Accept: "audio/wav",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: PREVIEW_TIMEOUT_MS,
        ...(identity ?? {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const status = response.statusCode ?? 502;
          if (status < 200 || status >= 300) {
            console.error(`[nova-dashboard] Iridium voice preview returned HTTP ${status}`);
            resolve({ ok: false, error: `HTTP ${status}`, status });
            return;
          }
          resolve({
            ok: true,
            audio: Buffer.concat(chunks),
            contentType: (response.headers["content-type"] as string) || "audio/wav",
          });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error("[nova-dashboard] Iridium voice preview request failed", error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ ok: false, error: code || error.message });
    });
    request.write(body);
    request.end();
  });
}

export type IridiumSatelliteStatus = {
  satelliteId: string;
  roomId?: string;
  connected?: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
  lastEventAt?: string;
};

// The voice server's in-memory registry of every satellite that has connected
// since it started. `connected` can be optimistic: a half-open socket keeps a
// satellite listed as connected until the server notices, so treat this as
// advisory status, not proof of a working pipeline.
export async function fetchIridiumSatelliteRegistry(): Promise<IridiumSatelliteStatus[] | null> {
  const payload = await fetchIridiumJson(SATELLITES_PATH, "satellite registry");
  if (!payload || !Array.isArray((payload as { satellites?: unknown }).satellites)) {
    return null;
  }
  return (payload as { satellites: IridiumSatelliteStatus[] }).satellites
    .filter((satellite) => typeof satellite?.satelliteId === "string");
}

// Iridium is authoritative for the voices and parameter ranges the deployed
// TTS/LLM stack supports; the dashboard's Voice Agent section populates its
// dropdowns from this instead of hard-coding model knowledge.
export async function fetchIridiumEngineStatus(): Promise<IridiumEngineStatus | null> {
  const payload = await fetchIridiumJson("/v1/engine", "engine status");
  const engine = (payload as { engine?: unknown } | null)?.engine;
  // Accept any non-empty engine id the server advertises rather than a
  // hardcoded pair, so a newly-registered engine (e.g. "trained") is usable
  // the moment the server knows about it — no dashboard release required.
  if (typeof engine !== "string" || !engine) {
    return null;
  }
  return payload as IridiumEngineStatus;
}

// Ask the voice server to swap the resident TTS engine. The server hands the
// swap to its root-side switcher and restarts itself, so a successful request
// is an acceptance, not a completion — callers follow progress by polling
// fetchIridiumEngineStatus() until the engine matches and its TTS is ready.
// The engine id is validated against the registry server-side (api.py's
// EngineSwitchRequest); the dashboard just passes through what the picker,
// itself populated from the server's own engine list, offered.
export async function requestIridiumEngineSwitch(
  engine: string,
): Promise<IridiumJsonResult> {
  return requestIridiumJson("/v1/engine", "engine switch", { method: "POST", body: { engine } });
}

export async function fetchIridiumVoiceCatalog(): Promise<IridiumVoiceCatalog | null> {
  const payload = await fetchIridiumJson(VOICES_PATH, "voices");
  if (payload && Array.isArray((payload as { voices?: unknown }).voices)) {
    return payload as IridiumVoiceCatalog;
  }
  return null;
}

export type IridiumEngineVoice = {
  id: string;
  name?: string;
  language?: string;
  speakerScale?: number;
};

// The registered voices for one engine's catalogue (Custom clones or Trained
// checkpoints), straight from that engine's own service registry -- the Voice
// Infrastructure catalogue panel renders this list. Engines with no
// catalogue (Classic) 404 server-side; treat that the same as "no voices".
export async function fetchIridiumEngineVoices(engineId: string): Promise<IridiumEngineVoice[] | null> {
  const payload = await fetchIridiumJson(
    `${VOICES_PATH}/${encodeURIComponent(engineId)}`,
    `${engineId} voices`,
  );
  if (!payload || !Array.isArray((payload as { voices?: unknown }).voices)) {
    return null;
  }
  return (payload as { voices: IridiumEngineVoice[] }).voices;
}

export type IridiumEngineVoiceBuildResult =
  | { ok: true; voice?: Record<string, unknown> }
  | { ok: false; error: string; status?: number };

// Relay a multipart voice-catalogue upload through to Iridium unchanged for
// the given engine -- the dashboard never parses the multipart body itself,
// it just forwards the browser's request bytes and content-type, exactly like
// the orchestrator's own relay to the engine's voice service does. For Custom
// this builds a reference.wav from sample clips (CPU ffmpeg, no GPU); for
// Trained this stores an already-trained checkpoint bundle.
export async function buildIridiumEngineVoice(
  engineId: string,
  body: Buffer,
  contentType: string,
): Promise<IridiumEngineVoiceBuildResult> {
  let url: URL;
  try {
    url = iridiumUrl(`${VOICES_PATH}/${encodeURIComponent(engineId)}`);
  } catch (error) {
    console.error(`[nova-dashboard] invalid Iridium ${engineId} voice URL`, error);
    return { ok: false, error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error(`[nova-dashboard] Iridium ${engineId} voice TLS identity is unavailable`, error);
      return { ok: false, error: "voice server TLS identity is unavailable" };
    }
  }
  return await new Promise<IridiumEngineVoiceBuildResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": contentType,
          "Content-Length": body.length,
        },
        timeout: ENGINE_VOICE_BUILD_TIMEOUT_MS,
        ...(identity ?? {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const status = response.statusCode ?? 502;
          const raw = Buffer.concat(chunks).toString("utf8");
          if (status < 200 || status >= 300) {
            console.error(`[nova-dashboard] Iridium ${engineId} voice build returned HTTP ${status}`);
            resolve({ ok: false, error: raw || `HTTP ${status}`, status });
            return;
          }
          try {
            const payload = JSON.parse(raw) as { voice?: Record<string, unknown> };
            resolve({ ok: true, voice: payload.voice });
          } catch (error) {
            console.error(`[nova-dashboard] Iridium ${engineId} voice build payload was invalid`, error);
            resolve({ ok: false, error: "invalid JSON payload from voice server", status });
          }
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error(`[nova-dashboard] Iridium ${engineId} voice build request failed`, error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ ok: false, error: code || error.message });
    });
    request.write(body);
    request.end();
  });
}

// Remove a registered voice from an engine's catalogue. Irreversible -- the
// engine's voice service deletes the voice's stored data outright.
export async function deleteIridiumEngineVoice(
  engineId: string,
  voiceId: string,
): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    `${VOICES_PATH}/${encodeURIComponent(engineId)}/${encodeURIComponent(voiceId)}`,
    `${engineId} voice delete`,
    { method: "DELETE" },
  );
}

export type IridiumRelayResult = {
  status: number;
  body: string;
  contentType: string;
};

// Voice-training relay. Unlike the other helpers here this one is deliberately
// shape-agnostic: it forwards method, body and content-type through to the voice
// server and hands back the raw response. The training endpoints cover JSON
// control calls and large multipart sample uploads alike, and the dashboard has
// no reason to re-parse either -- the voice server owns the contract and its
// error messages are written to be shown to the user as-is.
//
// The timeout is generous because a sample upload can be a hundred files.
export async function relayIridiumTraining(
  requestPath: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    body?: Buffer;
    contentType?: string;
    timeoutMs?: number;
  },
): Promise<IridiumRelayResult> {
  let url: URL;
  try {
    url = trainingUrl(requestPath);
  } catch (error) {
    console.error("[nova-dashboard] invalid Iridium training URL", error);
    return { status: 500, body: JSON.stringify({ detail: "configured voice server URL is invalid" }), contentType: "application/json" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] Iridium training TLS identity is unavailable", error);
      return { status: 502, body: JSON.stringify({ detail: "voice server TLS identity is unavailable" }), contentType: "application/json" };
    }
  }
  return await new Promise<IridiumRelayResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const headers: Record<string, string | number> = { Accept: "application/json" };
    if (options.body) {
      headers["Content-Length"] = options.body.length;
      if (options.contentType) headers["Content-Type"] = options.contentType;
    }
    const request = requester(
      url,
      {
        method: options.method,
        headers,
        timeout: options.timeoutMs ?? 300_000,
        ...(identity ?? {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 502,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: response.headers["content-type"] ?? "application/json",
          }),
        );
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error("[nova-dashboard] Iridium training request failed", error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({
        status: 502,
        body: JSON.stringify({ detail: `voice server unreachable (${code || error.message})` }),
        contentType: "application/json",
      });
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

type IridiumJsonResult = { payload: unknown } | { error: string; status?: number };

async function requestIridiumJson(
  requestPath: string,
  label: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<IridiumJsonResult> {
  let url: URL;
  try {
    url = iridiumUrl(requestPath);
  } catch (error) {
    console.error(`[nova-dashboard] invalid Iridium ${label} URL`, error);
    return { error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error(`[nova-dashboard] Iridium ${label} TLS identity is unavailable`, error);
      return { error: "voice server TLS identity is unavailable" };
    }
  }
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  return await new Promise<IridiumJsonResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(body === null ? {} : {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          }),
        },
        timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        ...(identity ?? {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const status = response.statusCode ?? 502;
          if (status < 200 || status >= 300) {
            console.error(`[nova-dashboard] Iridium ${label} returned HTTP ${status}`);
            resolve({ error: `HTTP ${status}`, status });
            return;
          }
          try {
            resolve({ payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
            return;
          } catch (error) {
            console.error(`[nova-dashboard] Iridium ${label} payload was invalid`, error);
          }
          resolve({ error: "invalid JSON payload", status });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error(`[nova-dashboard] Iridium ${label} request failed`, error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ error: code || error.message });
    });
    if (body !== null) request.write(body);
    request.end();
  });
}

// Ask the voice host to pick a reminder sigil for a reminder name.
//
// The LLM itself (llama-server) is bound to 127.0.0.1 on iridium and firewalled
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

  const result = await requestIridiumJson(CLASSIFY_ICON_PATH, "reminder icon classification", {
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

async function fetchIridiumJson(requestPath: string, label: string): Promise<unknown | null> {
  const result = await requestIridiumJson(requestPath, label);
  return "payload" in result ? result.payload : null;
}

export type SpeakerTemplateSummary = {
  id: string;
  state: "provisional" | "pending" | "active";
  sampleCount: number;
  claimedName?: string | null;
  claimedPronouns?: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string | null;
};

export type SpeakerProfileSummary = {
  id: string;
  displayName: string;
  pronouns?: string | null;
  speechPreferences?: {
    language: string;
    speech_rate: number;
    delivery_mode: "auto" | "normal" | "whisper";
    accessibility_pacing: boolean;
    pronunciations: Record<string, string>;
  };
  createdAt: string;
  updatedAt: string;
  templates: SpeakerTemplateSummary[];
};

export type SpeakerProfilesPayload = {
  enabled?: boolean;
  profiles: SpeakerProfileSummary[];
  provisionalTemplates: SpeakerTemplateSummary[];
};

export async function fetchIridiumSpeakerProfiles(): Promise<SpeakerProfilesPayload | null> {
  const payload = await fetchIridiumJson(SPEAKER_PROFILES_PATH, "speaker profiles");
  if (!payload || !Array.isArray((payload as SpeakerProfilesPayload).profiles)) return null;
  return payload as SpeakerProfilesPayload;
}

export async function updateIridiumSpeakerProfile(
  personId: string,
  update: {
    displayName?: string;
    pronouns?: string | null;
    speechPreferences?: NonNullable<SpeakerProfileSummary["speechPreferences"]>;
  },
): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    `${SPEAKER_PROFILES_PATH}/${encodeURIComponent(personId)}`,
    "speaker profile update",
    { method: "PATCH", body: {
      ...(update.displayName === undefined ? {} : { display_name: update.displayName }),
      ...(update.pronouns === undefined ? {} : { pronouns: update.pronouns }),
      ...(update.speechPreferences === undefined
        ? {}
        : { speech_preferences: update.speechPreferences }),
    } },
  );
}

export async function deleteIridiumSpeakerProfile(personId: string): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    `${SPEAKER_PROFILES_PATH}/${encodeURIComponent(personId)}`,
    "speaker profile deletion",
    { method: "DELETE" },
  );
}

export async function deleteIridiumSpeakerTemplate(templateId: string): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    `/v1/speaker-templates/${encodeURIComponent(templateId)}`,
    "speaker template deletion",
    { method: "DELETE" },
  );
}

export async function deleteAllIridiumSpeakerTemplates(): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    "/v1/speaker-templates",
    "all speaker templates deletion",
    { method: "DELETE" },
  );
}

// Clearing the transcript log clears the assistant's working context too: the
// visible record and what the model is still reasoning from are one thing to
// the person pressing clear. Best-effort — a voice server that is unreachable
// must never block the panel from clearing.
export async function endIridiumConversations(): Promise<IridiumJsonResult> {
  return requestIridiumJson("/v1/conversations", "conversation context clear", {
    method: "DELETE",
  });
}

export async function assignIridiumSpeakerTemplate(
  templateId: string,
  personId: string,
): Promise<IridiumJsonResult> {
  return requestIridiumJson(
    `/v1/speaker-templates/${encodeURIComponent(templateId)}`,
    "speaker template assignment",
    { method: "PATCH", body: { person_id: personId } },
  );
}

export type IridiumVoiceHealthProbe = {
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
  health?: unknown;
};

// One /health round trip against the voice server. `reachable` only means the
// server answered with a valid payload; the payload's own `ok` flags say
// whether each part of the stack is actually healthy.
export async function probeIridiumVoiceHealth(): Promise<IridiumVoiceHealthProbe> {
  const started = Date.now();
  const result = await requestIridiumJson(HEALTH_PATH, "health");
  if ("payload" in result) {
    return { reachable: true, latencyMs: Date.now() - started, health: result.payload };
  }
  return { reachable: false, latencyMs: null, error: result.error };
}

// Display label for status UIs: the configured voice-server host, never a
// machine name hard-coded by a caller.
export function iridiumVoiceHostLabel(): string {
  try {
    return iridiumUrl("/").host;
  } catch {
    return "voice server";
  }
}

export type AgentAdministrationPayload = {
  goals: Array<Record<string, unknown> & { id: string; status: string; summary: string }>;
  plans: Array<Record<string, unknown> & { id: string; status: string; goal_id: string }>;
  executions: Array<Record<string, unknown> & { id: string; status: string }>;
  grants: Array<Record<string, unknown> & {
    id: string;
    grantee_id: string;
    capability: string;
    active: boolean;
    target_scope: string[];
    expires_at?: string | null;
  }>;
  identities: Array<Record<string, unknown> & {
    person_id: string;
    role: "owner" | "recognized_household" | "guest";
  }>;
  research: AgentResearch[];
  briefingSchedules: AgentBriefingSchedule[];
  briefings: AgentBriefing[];
  subscriptions: AgentEventSubscription[];
  audit: Array<Record<string, unknown> & {
    id: string;
    actor_id: string;
    action: string;
    object_type: string;
    object_id: string;
    created_at: string;
  }>;
  auditTotal: number;
};

export type AgentResearch = {
  id: string;
  owner_id: string;
  query: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  spoken_summary?: string | null;
  detail: Record<string, unknown>;
  citations: string[];
  uncertainty: "low" | "medium" | "high";
  backend?: string | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type AgentBriefingSchedule = {
  id: string; owner_id: string; period: "morning" | "evening";
  local_time: string; timezone: string; enabled: boolean; last_local_date?: string | null;
};

export type AgentBriefing = {
  id: string; owner_id: string; period: "morning" | "evening"; local_date: string;
  summary: string; agenda: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>; preparation_prompts: string[];
};

export type AgentEventSubscription = {
  id: string; owner_id: string; summary: string; event_kind: string;
  match: Record<string, unknown>; active: boolean; one_shot: boolean;
  trigger_count: number; triggered_at?: string | null;
};

export async function fetchIridiumAgentAdministration(): Promise<AgentAdministrationPayload | null> {
  const payload = await fetchIridiumJson("/v1/agent/administration", "agent administration");
  if (!payload || !Array.isArray((payload as AgentAdministrationPayload).goals)) return null;
  return payload as AgentAdministrationPayload;
}

export type AgentMemory = {
  id: string;
  text: string;
  memory_type: string;
  owner_id?: string | null;
  pinned: boolean;
  needs_confirmation: boolean;
  created_at: string;
  expires_at?: string | null;
};

export async function fetchIridiumAgentMemories(): Promise<AgentMemory[] | null> {
  const payload = await fetchIridiumJson("/v1/agent/memories", "agent memories");
  return payload && Array.isArray((payload as { memories?: unknown }).memories)
    ? (payload as { memories: AgentMemory[] }).memories
    : null;
}

export function updateIridiumAgentMemory(memoryId: string, body: Record<string, unknown>) {
  return requestIridiumJson(`/v1/agent/memories/${encodeURIComponent(memoryId)}`, "agent memory update", {
    method: "PATCH", body,
  });
}

export function forgetIridiumAgentMemory(memoryId: string) {
  return requestIridiumJson(`/v1/agent/memories/${encodeURIComponent(memoryId)}`, "forget agent memory", {
    method: "DELETE",
  });
}

export function backupIridiumAgentMemories() {
  return requestIridiumJson("/v1/agent/memories/backup", "agent memory backup", { method: "POST" });
}

export function consolidateIridiumAgentMemories() {
  return requestIridiumJson("/v1/agent/memories/consolidate", "agent memory consolidation", { method: "POST" });
}

export function setIridiumAgentIdentityRole(personId: string, role: string) {
  return requestIridiumJson(
    `/v1/agent/identities/${encodeURIComponent(personId)}`,
    "agent identity role update",
    { method: "PUT", body: { role } },
  );
}

export function createIridiumDelegationGrant(grant: Record<string, unknown>) {
  return requestIridiumJson("/v1/agent/grants", "delegation grant creation", {
    method: "POST",
    body: grant,
  });
}

export function revokeIridiumDelegationGrant(grantId: string) {
  return requestIridiumJson(
    `/v1/agent/grants/${encodeURIComponent(grantId)}`,
    "delegation grant revocation",
    { method: "DELETE" },
  );
}

export function cancelIridiumAgentGoal(goalId: string, reason: string) {
  return requestIridiumJson(
    `/v1/agent/goals/${encodeURIComponent(goalId)}/cancel`,
    "durable goal cancellation",
    { method: "POST", body: { reason } },
  );
}

export type AgentAutomation = {
  id: string;
  owner_id: string;
  summary: string;
  trigger: Record<string, unknown>;
  proposed_actions: Array<Record<string, unknown>>;
  simulation?: Record<string, unknown> | null;
  state: "draft" | "simulated" | "approved" | "active" | "paused" | "rolled_back" | "failed";
  monitor_failures: number;
};

export type ProactiveIntervention = {
  id: string;
  reason_code: string;
  reason_detail: string;
  channel: "voice" | "dashboard" | "notification";
  status: string;
  feedback?: "accepted" | "dismissed" | "redundant" | "annoying" | null;
  created_at: string;
};

export async function fetchIridiumAgentAutomations(): Promise<AgentAutomation[] | null> {
  const payload = await fetchIridiumJson("/v1/agent/automations", "agent automations");
  return payload && Array.isArray((payload as { automations?: unknown }).automations)
    ? (payload as { automations: AgentAutomation[] }).automations
    : null;
}

export async function fetchIridiumProactiveInterventions(): Promise<ProactiveIntervention[] | null> {
  const payload = await fetchIridiumJson(
    "/v1/agent/proactive-interventions",
    "proactive interventions",
  );
  return payload && Array.isArray((payload as { interventions?: unknown }).interventions)
    ? (payload as { interventions: ProactiveIntervention[] }).interventions
    : null;
}

export function createIridiumAgentAutomation(
  ownerId: string,
  draft: Record<string, unknown>,
) {
  return requestIridiumJson(
    `/v1/agent/automations?owner_id=${encodeURIComponent(ownerId)}`,
    "agent automation draft",
    { method: "POST", body: draft },
  );
}

export function transitionIridiumAgentAutomation(
  automationId: string,
  action: "simulate" | "approve" | "activate" | "rollback",
  ownerId?: string,
) {
  const body = action === "simulate" ? undefined : { owner_id: ownerId };
  return requestIridiumJson(
    `/v1/agent/automations/${encodeURIComponent(automationId)}/${action}`,
    `agent automation ${action}`,
    { method: "POST", body },
  );
}

export function feedbackIridiumProactiveIntervention(
  interventionId: string,
  ownerId: string,
  outcome: "accepted" | "dismissed" | "redundant" | "annoying",
) {
  return requestIridiumJson(
    `/v1/agent/proactive-interventions/${encodeURIComponent(interventionId)}/feedback`,
    "proactive intervention feedback",
    { method: "POST", body: { owner_id: ownerId, outcome } },
  );
}
