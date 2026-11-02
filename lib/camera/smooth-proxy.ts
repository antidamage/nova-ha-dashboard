import { NextResponse } from "next/server";

/** The smooth delivery service, on this host. specs/camera-smooth-delivery.md. */
const SMOOTH_SERVICE_URL = process.env.NOVA_CAMERA_SMOOTH_URL?.trim() || "http://127.0.0.1:8095";
const SMOOTH_FILE = /^(index\.m3u8|seg_\d{1,9}\.ts)$/;

/**
 * Relays the smooth stream. Anything going wrong is a plain 503, which the panel
 * reads as "use the recording".
 */
export async function proxySmoothRequest(request: Request, path: string[]): Promise<Response> {
  if (path.length !== 1 || !SMOOTH_FILE.test(path[0])) {
    return NextResponse.json({ error: "Unknown smooth stream file" }, { status: 404 });
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const upstream = await fetch(`${SMOOTH_SERVICE_URL}/${path[0]}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Smooth stream unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
