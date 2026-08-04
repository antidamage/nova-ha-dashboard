import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The GPU renderer runs as its own systemd unit beside the dashboard, never as
// part of it — a renderer fault must not be able to take home control down. This
// proxies its status so the configuration page and the Apple TV client can see
// whether streaming is available without either needing to know the port.
//
// It also tells a client where to connect, so the stream endpoint stays a
// server-side detail rather than something baked into the tvOS build.
const RENDERER_CONTROL = process.env.NOVA_VISUALISER_CONTROL_URL ?? "http://127.0.0.1:8771";
const RENDERER_CONTROL_PORT = Number(new URL(RENDERER_CONTROL).port || 80);
const RENDERER_STREAM_PORT = Number(process.env.NOVA_VISUALISER_STREAM_PORT ?? 8770);
const RENDERER_SRT_PORT = Number(process.env.NOVA_VISUALISER_SRT_PORT ?? 8772);
// The browser rung is served by the MediaMTX sidecar, not by this service: the
// Apple TV feed is 4K HEVC over a bespoke socket, which no browser can decode.
// Ports match nova-visualiser/ops/mediamtx.yml.
const RENDERER_WHEP_PORT = Number(process.env.NOVA_VISUALISER_WHEP_PORT ?? 8889);
const RENDERER_HLS_PORT = Number(process.env.NOVA_VISUALISER_HLS_PORT ?? 8890);
const RENDERER_STREAM_PATH = process.env.NOVA_VISUALISER_STREAM_PATH ?? "visualiser";

// Where the client should connect for video. Derived from the Host header the
// client actually used, so an Apple TV that reached us as `nova.local` is told
// to stream from `nova.local`. `request.url`'s hostname is the server's bind
// address (0.0.0.0 behind Docker), which no client can connect to.
function resolveStreamHost(request: Request) {
  const configured = process.env.NOVA_VISUALISER_STREAM_HOST;
  if (configured) return configured;

  const header = request.headers.get("host") ?? "";
  // Strip the port; IPv6 literals keep their brackets.
  const host = header.startsWith("[")
    ? header.slice(0, header.indexOf("]") + 1)
    : header.split(":")[0];
  if (host && host !== "0.0.0.0" && host !== "[::]") return host;

  const fallback = new URL(request.url).hostname;
  return fallback === "0.0.0.0" || fallback === "[::]" ? "nova.local" : fallback;
}

export async function GET(request: Request) {
  const streamHost = resolveStreamHost(request);
  // Derived from the same Host header as the Apple TV endpoint, so a browser
  // that reached us as `nova.local` is told to play from `nova.local`.
  const whepUrl = `http://${streamHost}:${RENDERER_WHEP_PORT}/${RENDERER_STREAM_PATH}/whep`;
  const hlsUrl = `http://${streamHost}:${RENDERER_HLS_PORT}/${RENDERER_STREAM_PATH}/index.m3u8`;
  const signalUrl = `http://${streamHost}:${RENDERER_CONTROL_PORT}/signal`;

  try {
    const response = await fetch(`${RENDERER_CONTROL}/status`, {
      cache: "no-store",
      // Short: this is polled from a dashboard page, and an unreachable
      // renderer should read as "unavailable" promptly rather than hanging the
      // panel that reports it.
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`renderer returned ${response.status}`);
    const status = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(
      {
        available: true,
        streamHost,
        streamPort: RENDERER_STREAM_PORT,
        srtPort: status.srtAvailable === true ? Number(status.srtPort ?? RENDERER_SRT_PORT) : null,
        srtLatencyMs: Number(status.srtLatencyMs ?? 60),
        whepUrl,
        hlsUrl,
        signalUrl,
        status,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        streamHost,
        streamPort: RENDERER_STREAM_PORT,
        srtPort: null,
        srtLatencyMs: 60,
        whepUrl,
        hlsUrl,
        signalUrl,
        error: error instanceof Error ? error.message : "renderer unreachable",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

// Commands that only affect the running render (force a keyframe, re-read
// config, toggle the house-party lighting producer). Configuration changes
// still go through /api/phonoscope/config so the stored config stays the single
// source of truth.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { command?: unknown; payload?: unknown };
    const command = typeof body.command === "string" ? body.command : "";
    // `full-rate` takes the browser rung to full frame rate for a bounded
    // window so the debug viewer shows what the Apple TV actually receives
    // rather than a half-rate approximation. The renderer clamps the duration
    // and expires the lease itself, on time and on GPU pressure.
    if (!["keyframe", "refresh", "house-party", "full-rate", "telemetry"].includes(command)) {
      return NextResponse.json({ error: "unknown command" }, { status: 400 });
    }
    const response = await fetch(`${RENDERER_CONTROL}/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.payload ?? {}),
      signal: AbortSignal.timeout(2_000),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "renderer unreachable" },
      { status: 502 },
    );
  }
}
