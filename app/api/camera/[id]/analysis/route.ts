import { getCamera } from "../../../../../lib/camera/config";
import { proxyCameraEventsJson } from "../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function valid(context: Context) {
  const { id } = await context.params;
  return Boolean(getCamera(id));
}

export async function GET(_request: Request, context: Context) {
  return (await valid(context)) ? proxyCameraEventsJson("/settings") : Response.json({ error: "Unknown camera" }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  if (!(await valid(context))) return Response.json({ error: "Unknown camera" }, { status: 404 });
  return proxyCameraEventsJson("/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: await request.text() });
}

