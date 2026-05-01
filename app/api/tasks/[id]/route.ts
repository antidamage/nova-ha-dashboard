import { NextResponse } from "next/server";
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
    const body = await request.json();
    const patch: { name: unknown; start: unknown; end: unknown; repeat?: unknown } = {
      name: body.name,
      start: body.start,
      end: body.end,
    };
    if (Object.prototype.hasOwnProperty.call(body, "repeat")) {
      patch.repeat = body.repeat;
    }

    const task = await updateTask(id, patch);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update task" },
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
      { error: error instanceof Error ? error.message : "Failed to delete task" },
      { status: 400 },
    );
  }
}
