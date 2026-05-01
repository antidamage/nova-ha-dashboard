import { NextResponse } from "next/server";
import { addTask, readTasks } from "../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ tasks: await readTasks() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read tasks" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const task = await addTask({
      name: body.name,
      start: body.start,
      end: body.end,
      repeat: body.repeat,
      source: "local",
    });

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create task" },
      { status: 400 },
    );
  }
}
