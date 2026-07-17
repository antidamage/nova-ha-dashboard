import { NextResponse } from "next/server";
import { taskBulkImportInput } from "../../../../lib/api/task-requests";
import { addTasks, parseTaskCsv } from "../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = taskBulkImportInput(await request.json());
    const { tasks, errors } = parseTaskCsv(input.csv, input.referenceDate);
    const created = await addTasks(tasks);

    return NextResponse.json({ created, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import reminders" },
      { status: 400 },
    );
  }
}
