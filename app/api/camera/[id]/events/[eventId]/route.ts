import { getCamera } from "../../../../../../lib/camera/config";
import { proxyCameraEventsJson } from "../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; eventId: string }> };

async function target(context: Context) {
  const { id, eventId } = await context.params;
  return getCamera(id) ? `/events/${encodeURIComponent(eventId)}` : null;
}

export async function GET(_request: Request, context: Context) {
  const path = await target(context);
  return path ? proxyCameraEventsJson(path) : Response.json({ error: "Unknown camera" }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const path = await target(context);
  if (!path) return Response.json({ error: "Unknown camera" }, { status: 404 });
  return proxyCameraEventsJson(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

export async function DELETE(_request: Request, context: Context) {
  const path = await target(context);
  return path ? proxyCameraEventsJson(path, { method: "DELETE" }) : Response.json({ error: "Unknown camera" }, { status: 404 });
}

