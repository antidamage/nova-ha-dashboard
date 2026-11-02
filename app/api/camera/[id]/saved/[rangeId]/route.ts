import { NextResponse } from "next/server";
import { getCamera } from "../../../../../../lib/camera/config";
import { deleteRange } from "../../../../../../lib/camera/saved-ranges";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; rangeId: string }> }) {
  const { id, rangeId } = await context.params;
  const camera = getCamera(id);
  if (!camera) return NextResponse.json({ error: "Unknown camera" }, { status: 404 });
  if (!(await deleteRange(camera, rangeId))) return NextResponse.json({ error: "Range not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
