import { getCamera } from "../../../../../../lib/camera/config";
import { proxyCameraEventsJson } from "../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getCamera(id) ? proxyCameraEventsJson("/healthz") : Response.json({ error: "Unknown camera" }, { status: 404 });
}

