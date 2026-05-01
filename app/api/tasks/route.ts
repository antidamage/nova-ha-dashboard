import { NextResponse } from "next/server";
import { subscribeTaskEvents } from "../../../lib/dashboard-events";
import { addTask, deleteTasks, readTasks, updateTask } from "../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const taskCommandDocs = {
  endpoint: "/api/tasks",
  description: "Command API for Nova dashboard tasks. Provide a command in the query string or JSON body.",
  mcpEndpoint: "/api/tasks/mcp",
  commands: {
    list: {
      method: "GET",
      example: "/api/tasks?command=list",
      response: "{ tasks: Task[] }",
    },
    listen: {
      method: "GET",
      example: "/api/tasks?command=listen",
      response: "text/event-stream with client-id, tasks, task-alert, and task-dismiss events",
    },
    add: {
      method: "POST",
      example: {
        command: "add",
        name: "Medication",
        start: "2026-05-01T21:00:00+12:00",
        end: null,
        repeat: { kind: "days", intervalDays: 1 },
      },
    },
    update: {
      method: "POST or PATCH",
      example: {
        command: "update",
        id: "task-id",
        name: "Updated title",
        start: "2026-05-01T22:00:00+12:00",
        end: null,
        repeat: null,
      },
    },
    remove: {
      method: "POST or DELETE",
      example: {
        command: "remove",
        id: "task-id",
      },
    },
  },
  repeatFormats: [
    { kind: "hourly" },
    { kind: "morning-night" },
    { kind: "days", intervalDays: 1 },
    null,
  ],
};

type TaskCommand = "add" | "delete" | "docs" | "list" | "listen" | "remove" | "update";

function commandFrom(request: Request, body?: Record<string, unknown>): TaskCommand {
  const url = new URL(request.url);
  const command = String(url.searchParams.get("command") ?? body?.command ?? "").trim().toLowerCase();
  if (["add", "delete", "docs", "list", "listen", "remove", "update"].includes(command)) {
    return command as TaskCommand;
  }
  return "docs";
}

function documentationResponse(status = 200) {
  return NextResponse.json(taskCommandDocs, { status });
}

function taskEventStreamResponse() {
  return new Response(subscribeTaskEvents(), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function taskIdsFrom(value: unknown, fallback?: unknown) {
  const raw = value ?? fallback;
  if (Array.isArray(raw)) {
    return raw.map(String).map((id) => id.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  }
  return [];
}

function updatePatchFrom(body: Record<string, unknown>) {
  const patch: { name?: unknown; start?: unknown; end?: unknown; repeat?: unknown } = {};
  for (const key of ["name", "start", "end", "repeat"] as const) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  return patch;
}

async function runJsonCommand(command: TaskCommand, body: Record<string, unknown>, request: Request) {
  const url = new URL(request.url);

  if (command === "docs") {
    return documentationResponse();
  }
  if (command === "list") {
    return NextResponse.json({ tasks: await readTasks() });
  }
  if (command === "listen") {
    return taskEventStreamResponse();
  }
  if (command === "add") {
    const task = await addTask({
      name: body.name,
      start: body.start,
      end: body.end,
      repeat: body.repeat,
      source: "local",
    });
    return NextResponse.json(task);
  }
  if (command === "update") {
    const id = String(body.id ?? url.searchParams.get("id") ?? "").trim();
    if (!id) {
      throw new Error("Task id is required");
    }
    return NextResponse.json(await updateTask(id, updatePatchFrom(body)));
  }

  const ids = taskIdsFrom(body.ids, body.id ?? url.searchParams.get("ids") ?? url.searchParams.get("id"));
  if (!ids.length) {
    throw new Error("Task id is required");
  }

  await deleteTasks(ids);
  return NextResponse.json({ ok: true, removed: ids });
}

async function bodyFromRequest(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return {};
  }

  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function GET(request: Request) {
  try {
    const command = commandFrom(request);
    if (command === "listen") {
      return taskEventStreamResponse();
    }
    if (command === "list") {
      return NextResponse.json({ tasks: await readTasks() });
    }
    return documentationResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read tasks" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await bodyFromRequest(request);
    return await runJsonCommand(commandFrom(request, body), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Task command failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await bodyFromRequest(request);
    return await runJsonCommand(commandFrom(request, { ...body, command: body.command ?? "update" }), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Task update failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await bodyFromRequest(request);
    return await runJsonCommand(commandFrom(request, { ...body, command: body.command ?? "remove" }), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Task removal failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}
