import { getCamera } from "../../../../../../../lib/camera/config";
import { cameraEventsFetch } from "../../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; eventId: string; asset: string }> }) {
  const { id, eventId, asset } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  if (asset !== "thumbnail" && asset !== "clip") return Response.json({ error: "Unknown event asset" }, { status: 404 });
  try {
    const range = request.headers.get("range");
    const upstream = await cameraEventsFetch(`/events/${encodeURIComponent(eventId)}/${asset}`, {
      headers: range ? { Range: range } : undefined,
    });
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", asset === "thumbnail" ? "private, max-age=60" : "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Camera analysis unavailable" }, { status: 503 });
  }
}

