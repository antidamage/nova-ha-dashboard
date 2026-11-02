import { NextResponse } from "next/server";

/** The smooth delivery service, on this host. specs/camera-smooth-delivery.md. */
const SMOOTH_SERVICE_URL = process.env.NOVA_CAMERA_SMOOTH_URL?.trim() || "http://127.0.0.1:8095";
const SMOOTH_STREAM = /^(at\/(recording|range_\d{1,16})\/\d{1,16}\/(0\.5|1)\/)?(index\.m3u8|seg_\d{1,9}\.ts)$/;
const SMOOTH_RENDER = /^render\/range_\d{1,16}\.mp4$/;
const DOWNLOAD_NAME = /^[\w.-]{1,120}$/;

/**
 * Relays the smooth stream, and a saved range's 60 fps download. Anything going wrong
 * is a plain 503, which the panel reads as "use the recording".
 */
export async function proxySmoothRequest(request: Request, path: string[]): Promise<Response> {
  const joined = path.join("/");
  const rendering = SMOOTH_RENDER.test(joined);
  if (!rendering && joined !== "status" && !SMOOTH_STREAM.test(joined)) {
    return NextResponse.json({ error: "Unknown smooth stream file" }, { status: 404 });
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const upstream = await fetch(`${SMOOTH_SERVICE_URL}/${joined}`, {
      method,
      cache: "no-store",
      // A download lasts as long as its footage, and an abandoned one ends the render.
      signal: rendering ? request.signal : AbortSignal.timeout(5_000),
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    const name = new URL(request.url).searchParams.get("name");
    if (rendering && upstream.ok && name && DOWNLOAD_NAME.test(name)) {
      headers.set("Content-Disposition", `attachment; filename="${name}"`);
    }
    return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: "Smooth stream unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
