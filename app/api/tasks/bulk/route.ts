import { NextResponse } from "next/server";
import { addTasks, parseTaskCsv } from "../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function referenceDateFromBody(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tasks, errors } = parseTaskCsv(String(body.csv ?? ""), referenceDateFromBody(body.referenceDate));
    const created = await addTasks(tasks);

    return NextResponse.json({ created, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import tasks" },
      { status: 400 },
    );
  }
}
