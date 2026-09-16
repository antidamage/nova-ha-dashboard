import http from "node:http";
import https from "node:https";
import { ENGINE_VOICE_BUILD_TIMEOUT_MS, VOICES_PATH, trainingUrl, voiceHostUrl } from "./endpoints";
import { tlsIdentity } from "./store";
import type { VoiceHostEngineVoiceBuildResult, VoiceHostRelayResult } from "./types";

// Relay a multipart voice-catalogue upload through to voice host unchanged for
// the given engine -- the dashboard never parses the multipart body itself,
// it just forwards the browser's request bytes and content-type, exactly like
// the orchestrator's own relay to the engine's voice service does. For Custom
// this builds a reference.wav from sample clips (CPU ffmpeg, no GPU); for
// Trained this stores an already-trained checkpoint bundle.
export async function buildVoiceHostEngineVoice(
  engineId: string,
  body: Buffer,
  contentType: string,
): Promise<VoiceHostEngineVoiceBuildResult> {
  let url: URL;
  try {
    url = voiceHostUrl(`${VOICES_PATH}/${encodeURIComponent(engineId)}`);
  } catch (error) {
    console.error(`[nova-dashboard] invalid voice host ${engineId} voice URL`, error);
    return { ok: false, error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error(`[nova-dashboard] voice host ${engineId} voice TLS identity is unavailable`, error);
      return { ok: false, error: "voice server TLS identity is unavailable" };
    }
  }
  return await new Promise<VoiceHostEngineVoiceBuildResult>((resolve) => {
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
            console.error(`[nova-dashboard] voice host ${engineId} voice build returned HTTP ${status}`);
            resolve({ ok: false, error: raw || `HTTP ${status}`, status });
            return;
          }
          try {
            const payload = JSON.parse(raw) as { voice?: Record<string, unknown> };
            resolve({ ok: true, voice: payload.voice });
          } catch (error) {
            console.error(`[nova-dashboard] voice host ${engineId} voice build payload was invalid`, error);
            resolve({ ok: false, error: "invalid JSON payload from voice server", status });
          }
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error(`[nova-dashboard] voice host ${engineId} voice build request failed`, error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ ok: false, error: code || error.message });
    });
    request.write(body);
    request.end();
  });
}

// Voice-training relay. Unlike the other helpers here this one is deliberately
// shape-agnostic: it forwards method, body and content-type through to the voice
// server and hands back the raw response. The training endpoints cover JSON
// control calls and large multipart sample uploads alike, and the dashboard has
// no reason to re-parse either -- the voice server owns the contract and its
// error messages are written to be shown to the user as-is.
//
// The timeout is generous because a sample upload can be a hundred files.
export async function relayVoiceHostTraining(
  requestPath: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    body?: Buffer;
    contentType?: string;
    timeoutMs?: number;
  },
): Promise<VoiceHostRelayResult> {
  let url: URL;
  try {
    url = trainingUrl(requestPath);
  } catch (error) {
    console.error("[nova-dashboard] invalid voice host training URL", error);
    return { status: 500, body: JSON.stringify({ detail: "configured voice server URL is invalid" }), contentType: "application/json" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] voice host training TLS identity is unavailable", error);
      return { status: 502, body: JSON.stringify({ detail: "voice server TLS identity is unavailable" }), contentType: "application/json" };
    }
  }
  return await new Promise<VoiceHostRelayResult>((resolve) => {
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
      console.error("[nova-dashboard] voice host training request failed", error);
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
