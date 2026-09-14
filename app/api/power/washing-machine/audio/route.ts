import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readDashboardConfigSync } from "../../../../../lib/dashboard-config";
import { readTasks } from "../../../../../lib/tasks";
import { washReminder } from "../../../../../lib/wash-reminder";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId");
  const task = taskId ? (await readTasks()).find((task) => task.id === taskId) : undefined;
  const file = taskId ? (task ? washReminder(task)?.soundFile : undefined) : readDashboardConfigSync().power.washingMachine?.completionAlert?.soundFile;
  if (!file || !/^[a-zA-Z0-9_-]+\.mp3$/.test(file)) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(path.join(process.env.NOVA_HOUSEHOLD_AUDIO_DIR ?? path.join(process.cwd(), "data", "household-audio"), file));
    return new NextResponse(data, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
