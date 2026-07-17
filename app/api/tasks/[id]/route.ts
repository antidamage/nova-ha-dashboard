import { NextResponse } from "next/server";
import { taskRoutePatchFrom } from "../../../../lib/api/task-requests";
import { deleteTasks, updateTask } from "../../../../lib/tasks";

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
    const patch = taskRoutePatchFrom(await request.json());
    const task = await updateTask(id, patch);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update reminder" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteTasks([id]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete reminder" },
      { status: 400 },
    );
  }
}
