import { NextResponse } from "next/server";
import { taskBulkImportInput } from "../../../../lib/api/task-requests";
import { addTasks, parseTaskCsv } from "../../../../lib/tasks";
import { accessStatus, ownershipForNewTask, readAccess } from "../../../../lib/tasks/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = taskBulkImportInput(raw);
    const { tasks, errors } = parseTaskCsv(input.csv, input.referenceDate);
    // Every imported reminder is the importing user's; household and undecided viewers are refused.
    const ownership = ownershipForNewTask(await readAccess(request), raw ?? {});
    const created = await addTasks(tasks.map((task) => ({ ...task, ...ownership })));

    return NextResponse.json({ created, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import reminders" },
      { status: accessStatus(error, 400) },
    );
  }
}
