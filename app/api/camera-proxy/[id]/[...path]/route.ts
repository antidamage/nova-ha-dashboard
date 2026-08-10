import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

type RouteContext = { params: Promise<{ id: string; path: string[] }> };

function configuredVideoHost(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim().replace(/\/+$/, ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

async function proxyCameraRequest(request: Request, context: RouteContext) {
  const { id, path } = await context.params;
  if (id !== "outside" || path.length === 0) {
    return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  }

  const config = await readDashboardConfig();
  const host = configuredVideoHost(config.dashboard.camera.outside.videoHostUrl);
  if (!host) {
    return NextResponse.json({ error: "Remote camera host is not configured" }, { status: 503 });
  }

  const upstream = new URL(
    `${host.toString().replace(/\/+$/, "")}/camera/${encodeURIComponent(id)}/${path.map(encodeURIComponent).join("/")}`,
  );
  upstream.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Undici transparently decompresses upstream bodies. Requesting identity
  // keeps Content-Length valid when we relay the response unchanged.
  headers.set("accept-encoding", "identity");

  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  try {
    const upstreamResponse = await fetch(upstream, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstreamResponse.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Remote camera host unavailable", detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = proxyCameraRequest;
export const HEAD = proxyCameraRequest;
export const POST = proxyCameraRequest;
export const PUT = proxyCameraRequest;
export const OPTIONS = proxyCameraRequest;
