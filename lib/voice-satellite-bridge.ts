// Browser voice-satellite bridge.
//
// A browser cannot present a client certificate on a WebSocket handshake, so it
// cannot talk to the voice server's mTLS /v1/satellites endpoint directly. This
// Caddy terminates the browser's same-origin WSS connection, then proxies over
// loopback to this bridge's household-CA TLS listener. The bridge relays every
// frame to voice host over a fresh mTLS WebSocket using the dashboard's client identity
// (data/nova-voice-tls/). It is a dumb pipe: NVAF binary frames and JSON control
// messages pass through untouched in both directions, so all audio DSP, turn
// gating, and the push-to-talk begin_turn frame are handled server-side exactly
// as for a native satellite.
//
// The bridge is inert until a server certificate is provisioned
// (NOVA_DASHBOARD_TLS_CERT/KEY). The certificate secures the internal Caddy hop;
// household browsers trust only Caddy's automatically managed Tailscale cert.

import { readFile } from "node:fs/promises";
import https from "node:https";
import { WebSocket, WebSocketServer } from "ws";
import { voiceHostBaseUrl, readVoiceTlsIdentity } from "./voice-host-settings";

const BRIDGE_PATH = "/voice-satellite";

function bridgePort(): number {
  const raw = Number(process.env.NOVA_VOICE_BRIDGE_PORT);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 8767;
}

/** Optional shared secret; when set, browsers must pass ?token=... to connect. */
function requiredToken(): string | null {
  const token = process.env.NOVA_VOICE_BRIDGE_TOKEN?.trim();
  return token ? token : null;
}

function voiceHostSatelliteWsUrl(): string {
  // Reuse the configured voice host base (https://host:8766) and swap to wss.
  const base = new URL(voiceHostBaseUrl());
  base.protocol = base.protocol === "http:" ? "ws:" : "wss:";
  base.pathname = "/v1/satellites";
  base.search = "";
  return base.toString();
}

async function readServerTls(): Promise<{ cert: Buffer; key: Buffer } | null> {
  const certPath = process.env.NOVA_DASHBOARD_TLS_CERT?.trim();
  const keyPath = process.env.NOVA_DASHBOARD_TLS_KEY?.trim();
  if (!certPath || !keyPath) {
    return null;
  }
  const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)]);
  return { cert, key };
}

let started = false;

/**
 * Start the browser voice-satellite bridge. Safe to call once at server boot;
 * a no-op when the dashboard server certificate is not configured.
 */
export async function startVoiceSatelliteBridge(): Promise<void> {
  if (started) return;
  started = true;

  const serverTls = await readServerTls();
  if (!serverTls) {
    console.log(
      "[voice-bridge] disabled: set NOVA_DASHBOARD_TLS_CERT/KEY to enable the browser satellite bridge",
    );
    return;
  }

  let clientIdentity: { ca: Buffer; cert: Buffer; key: Buffer };
  try {
    clientIdentity = await readVoiceTlsIdentity();
  } catch (error) {
    console.error("[voice-bridge] disabled: missing mTLS client identity (data/nova-voice-tls)", error);
    return;
  }

  const upstreamUrl = voiceHostSatelliteWsUrl();
  const token = requiredToken();

  const httpsServer = https.createServer({ cert: serverTls.cert, key: serverTls.key });
  const wss = new WebSocketServer({ server: httpsServer, path: BRIDGE_PATH });

  wss.on("connection", (browser, request) => {
    if (token) {
      const url = new URL(request.url ?? "", "https://localhost");
      if (url.searchParams.get("token") !== token) {
        browser.close(1008, "unauthorized");
        return;
      }
    }

    // Open the mTLS upstream socket. Frames from the browser buffer until it is
    // open (a fresh connection sends its hello immediately).
    const upstream = new WebSocket(upstreamUrl, {
      ca: clientIdentity.ca,
      cert: clientIdentity.cert,
      key: clientIdentity.key,
    });

    const pending: Array<string | Buffer> = [];
    let upstreamOpen = false;

    const forwardToUpstream = (data: string | Buffer) => {
      if (upstreamOpen) {
        upstream.send(data);
      } else {
        pending.push(data);
      }
    };

    upstream.on("open", () => {
      upstreamOpen = true;
      for (const data of pending.splice(0)) {
        upstream.send(data);
      }
    });
    upstream.on("message", (data, isBinary) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(data, { binary: isBinary });
      }
    });
    upstream.on("close", (code, reason) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.close(normalizeCloseCode(code), reason.toString().slice(0, 120));
      }
    });
    upstream.on("error", (error) => {
      console.error("[voice-bridge] upstream error", error);
      if (browser.readyState === WebSocket.OPEN) {
        browser.close(1011, "upstream error");
      }
    });

    browser.on("message", (data, isBinary) => {
      // Text control frames arrive as Buffers with isBinary=false; preserve the
      // text/binary distinction the NVAF protocol relies on.
      forwardToUpstream(isBinary ? (data as Buffer) : data.toString());
    });
    browser.on("close", () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    });
    browser.on("error", () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    });
  });

  const port = bridgePort();
  httpsServer.on("error", (error) => {
    console.error("[voice-bridge] server error", error);
  });
  httpsServer.listen(port, () => {
    console.log(`[voice-bridge] browser satellite bridge listening on wss://:${port}${BRIDGE_PATH}`);
  });
}

// WebSocket close codes 1005/1006 are reserved and must not be sent explicitly;
// map them to a normal closure when propagating an upstream close.
function normalizeCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code < 1000 || code > 4999) {
    return 1000;
  }
  return code;
}
