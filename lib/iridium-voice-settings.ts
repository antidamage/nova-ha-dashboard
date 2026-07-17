import { readFile } from "fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";

export type IridiumVoiceRefreshResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number };

// Deployments set NOVA_VOICE_IRIDIUM_URL (see PRIVATEREF.md#1.3); this
// fallback is a generic placeholder for unconfigured installs.
const DEFAULT_IRIDIUM_URL = "https://voice-server.local:8766";
const REFRESH_PATH = "/v1/settings/refresh";
const VOICES_PATH = "/v1/voices";
const HEALTH_PATH = "/health";
// The monitor snapshot is the server's live satellite registry. A high cursor
// skips the event backlog; only the `satellites` array matters here.
const SATELLITES_PATH = "/v1/monitor/events?after=1000000000";
const REQUEST_TIMEOUT_MS = 5_000;

export type IridiumVoiceCatalog = {
  voices: { value: string; label: string; detail: string }[];
  languages: string[];
  accents: string[];
  emotions: string[];
  ranges: Record<string, { min: number; max: number; step: number; default: number }>;
  current?: unknown;
};

function iridiumUrl(path: string) {
  const baseUrl = process.env.NOVA_VOICE_IRIDIUM_URL?.trim() || DEFAULT_IRIDIUM_URL;
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
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
export async function fetchIridiumVoiceCatalog(): Promise<IridiumVoiceCatalog | null> {
  const payload = await fetchIridiumJson(VOICES_PATH, "voices");
  if (payload && Array.isArray((payload as { voices?: unknown }).voices)) {
    return payload as IridiumVoiceCatalog;
  }
  return null;
}

type IridiumJsonResult = { payload: unknown } | { error: string; status?: number };

async function requestIridiumJson(requestPath: string, label: string): Promise<IridiumJsonResult> {
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
  return await new Promise<IridiumJsonResult>((resolve) => {
    const requester = url.protocol === "https:" ? https.request : http.request;
    const request = requester(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
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
    request.end();
  });
}

async function fetchIridiumJson(requestPath: string, label: string): Promise<unknown | null> {
  const result = await requestIridiumJson(requestPath, label);
  return "payload" in result ? result.payload : null;
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
