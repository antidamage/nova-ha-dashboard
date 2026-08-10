import { getCamera } from "../../../../../../lib/camera/config";
import { cameraEventsFetch } from "../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  try {
    const upstream = await cameraEventsFetch("/frame");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Camera analysis unavailable" }, { status: 503 });
  }
}
