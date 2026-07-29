import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../../lib/dashboard-config";
import { uncompleteTask } from "../../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// Take back a completion made from the reminder icon bar. The undo window is
// server-side config, not a client-supplied number, so a stale tab cannot
// resurrect a reminder finished hours ago.
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const config = await readDashboardConfig();
    const task = await uncompleteTask(id, config.dashboard.reminders.undoWindowMs);

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to restore reminder" },
      { status: 400 },
    );
  }
}
