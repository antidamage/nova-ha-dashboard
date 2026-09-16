import http from "node:http";
import https from "node:https";
import { REQUEST_TIMEOUT_MS, voiceHostUrl } from "./endpoints";
import { tlsIdentity } from "./store";
import type { VoiceHostJsonResult } from "./types";

export async function requestVoiceHostJson(
  requestPath: string,
  label: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<VoiceHostJsonResult> {
  let url: URL;
  try {
    url = voiceHostUrl(requestPath);
  } catch (error) {
    console.error(`[nova-dashboard] invalid voice host ${label} URL`, error);
    return { error: "configured voice server URL is invalid" };
  }
  let identity: Awaited<ReturnType<typeof tlsIdentity>> | undefined;
  if (url.protocol === "https:") {
    try {
      identity = await tlsIdentity();
    } catch (error) {
      console.error(`[nova-dashboard] voice host ${label} TLS identity is unavailable`, error);
      return { error: "voice server TLS identity is unavailable" };
    }
  }
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  return await new Promise<VoiceHostJsonResult>((resolve) => {
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
            console.error(`[nova-dashboard] voice host ${label} returned HTTP ${status}`);
            resolve({ error: `HTTP ${status}`, status });
            return;
          }
          try {
            resolve({ payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
            return;
          } catch (error) {
            console.error(`[nova-dashboard] voice host ${label} payload was invalid`, error);
          }
          resolve({ error: "invalid JSON payload", status });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("request timed out")));
    request.once("error", (error) => {
      console.error(`[nova-dashboard] voice host ${label} request failed`, error);
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ error: code || error.message });
    });
    if (body !== null) request.write(body);
    request.end();
  });
}

export async function fetchVoiceHostJson(requestPath: string, label: string): Promise<unknown | null> {
  const result = await requestVoiceHostJson(requestPath, label);
  return "payload" in result ? result.payload : null;
}
