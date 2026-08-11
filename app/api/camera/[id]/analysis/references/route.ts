import { getCamera } from "../../../../../../lib/camera/config";
import { cameraEventsFetch, proxyCameraEventsJson } from "../../../../../../lib/camera-events-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  return proxyCameraEventsJson(`/references${new URL(request.url).search}`);
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!getCamera(id)) return Response.json({ error: "Unknown camera" }, { status: 404 });
  const incoming = await request.formData();
  const kind = String(incoming.get("kind") ?? "");
  const name = String(incoming.get("name") ?? "");
  const role = String(incoming.get("role") ?? "");
  const crop = String(incoming.get("crop") ?? "");
  const sourceName = String(incoming.get("sourceName") ?? "");
  const image = incoming.get("image");
  if (!(image instanceof File)) return Response.json({ error: "Reference image is required" }, { status: 400 });
  const outgoing = new FormData();
  outgoing.set("image", image);
  try {
    const query = new URLSearchParams({ kind, name });
    if (role) query.set("role", role);
    if (crop) query.set("crop", crop);
    if (sourceName) query.set("source_name", sourceName);
    const response = await cameraEventsFetch(`/references?${query}`, { method: "POST", body: outgoing });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Camera analysis unavailable" }, { status: 503 });
  }
}
