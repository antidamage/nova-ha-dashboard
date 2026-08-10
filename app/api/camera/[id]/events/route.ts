import { getCamera } from "../../../../../lib/camera/config";
import { proxyCameraEventsJson } from "../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  const query = new URL(request.url).search;
  return proxyCameraEventsJson(`/events${query}`);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  return proxyCameraEventsJson("/events", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}
