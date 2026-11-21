import { NextResponse } from "next/server";
import { accessStatus, requireActionableTask } from "../../../../../lib/tasks/access";
import { completeTask } from "../../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requireActionableTask(request, id);
    const task = await completeTask(id);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to complete reminder" },
      { status: accessStatus(error, 400) },
    );
  }
}
