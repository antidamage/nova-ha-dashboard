import { getCamera } from "../../../../../../../../lib/camera/config";
import { cameraEventsFetch } from "../../../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; referenceId: string }> }) {
  const { id, referenceId } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  try {
    const response = await cameraEventsFetch(`/references/${encodeURIComponent(referenceId)}/image`);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Camera analysis unavailable" }, { status: 503 });
  }
}
