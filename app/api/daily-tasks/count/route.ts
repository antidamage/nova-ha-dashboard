import { NextResponse } from "next/server";
import { readDailyTasksCount } from "../../../../lib/daily-tasks/count";
import { readDashboardConfig } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The reminder bar's daily tasks tile reads this. The count is fetched here,
// server-side, so the browser needs no route to the tasks site and no CORS.
// specs/tasks-panel.md, "Daily tasks count".
export async function GET() {
  const config = await readDashboardConfig();
  const result = await readDailyTasksCount(config.dashboard.reminders.dailyTasksUrl);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
