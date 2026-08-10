import { getCamera } from "../../../../../../../lib/camera/config";
import { proxyCameraEventsJson } from "../../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; referenceId: string }> }) {
  const { id, referenceId } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  return proxyCameraEventsJson(`/references/${encodeURIComponent(referenceId)}`, { method: "DELETE" });
}

