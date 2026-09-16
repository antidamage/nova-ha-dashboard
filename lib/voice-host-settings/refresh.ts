import http from "node:http";
import https from "node:https";
import { PREVIEW_PATH, PREVIEW_TIMEOUT_MS, REQUEST_TIMEOUT_MS, refreshUrl, voiceHostUrl } from "./endpoints";
import { tlsIdentity } from "./store";
import type { VoiceHostPreviewResult, VoiceHostRefreshResult } from "./types";

export async function triggerVoiceHostSettingsRefresh(): Promise<VoiceHostRefreshResult> {
  let url: URL;
  try {
    url = refreshUrl();
  } catch (error) {
    console.error("[nova-dashboard] invalid voice host URL", error);
    return { ok: false, error: "Voice host refresh URL is invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Voice host refresh URL must use HTTP or HTTPS" };
  }

  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] voice host TLS identity is unavailable", error);
      return { ok: false, error: "Voice host refresh TLS identity is unavailable" };
    }
  }

  return await new Promise<VoiceHostRefreshResult>((resolve) => {
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
          console.error(`[nova-dashboard] voice host refresh returned HTTP ${status}`);
          resolve({ ok: false, error: "Voice host rejected the voice settings refresh", status });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error("[nova-dashboard] voice host refresh request failed", error);
      resolve({ ok: false, error: "Voice host refresh request failed" });
    });
    request.end();
  });
}

// POST a short synthesis request to voice host and hand back the raw WAV bytes.
// The personality Test button plays this in the browser; the dashboard makes
// the mTLS round trip so no browser ever needs the voice-server TLS identity.
export async function fetchVoiceHostPreview(text?: string): Promise<VoiceHostPreviewResult> {
  let url: URL;
  try {
    url = voiceHostUrl(PREVIEW_PATH);
  } catch (error) {
    console.error("[nova-dashboard] invalid voice host preview URL", error);
    return { ok: false, error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error("[nova-dashboard] voice host preview TLS identity is unavailable", error);
      return { ok: false, error: "voice server TLS identity is unavailable" };
    }
  }
  const body = JSON.stringify({ text: typeof text === "string" ? text : null });
  return await new Promise<VoiceHostPreviewResult>((resolve) => {
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
            console.error(`[nova-dashboard] voice host preview returned HTTP ${status}`);
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
      console.error("[nova-dashboard] voice host preview request failed", error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ ok: false, error: code || error.message });
    });
    request.write(body);
    request.end();
  });
}
