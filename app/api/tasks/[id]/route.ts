import { NextResponse } from "next/server";
import { taskRoutePatchFrom } from "../../../../lib/api/task-requests";
import { deleteTasks, updateTask } from "../../../../lib/tasks";
import { accessPatchFor, accessStatus, readAccess, requireFollowsAnchor, requireWritableTasks } from "../../../../lib/tasks/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const access = await readAccess(request);
    await requireWritableTasks(access, [id]);
    const body = await request.json();
    await requireFollowsAnchor(access, (body ?? {}).follows);
    const patch = { ...taskRoutePatchFrom(body), ...accessPatchFor(access, (body ?? {}) as Record<string, unknown>) };
    const task = await updateTask(id, patch);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update reminder" },
      { status: accessStatus(error, 400) },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requireWritableTasks(await readAccess(request), [id]);
    await deleteTasks([id]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete reminder" },
      { status: accessStatus(error, 400) },
    );
  }
}
