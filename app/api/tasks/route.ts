import { NextResponse } from "next/server";
import {
  taskBodyFromRequest,
  taskCommandFrom,
  taskIdsFrom,
  taskUpdatePatchFrom,
  type TaskCommand,
} from "../../../lib/api/task-requests";
import { subscribeTaskEvents } from "../../../lib/dashboard-events";
import { addTask, deleteTasks, readTasks, updateTask } from "../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const taskCommandDocs = {
  endpoint: "/api/tasks",
  description: "Command API for Nova dashboard tasks. Provide a command in the query string or JSON body.",
  mcpEndpoint: "/api/mcp",
  legacyMcpEndpoint: "/api/tasks/mcp",
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
        annoy: false,
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
  annoy: "Optional. When true the reminder keeps chiming until dismissed. Otherwise it chimes once per occurrence, across all screens.",
  repeatFormats: [
    { kind: "hourly" },
    { kind: "morning-night" },
    { kind: "days", intervalDays: 1 },
    null,
  ],
};

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
      annoy: body.annoy,
      source: "local",
    });
    return NextResponse.json(task);
  }
  if (command === "update") {
    const id = String(body.id ?? url.searchParams.get("id") ?? "").trim();
    if (!id) {
      throw new Error("Task id is required");
    }
    return NextResponse.json(await updateTask(id, taskUpdatePatchFrom(body)));
  }

  const ids = taskIdsFrom(body.ids, body.id ?? url.searchParams.get("ids") ?? url.searchParams.get("id"));
  if (!ids.length) {
    throw new Error("Task id is required");
  }

  await deleteTasks(ids);
  return NextResponse.json({ ok: true, removed: ids });
}

export async function GET(request: Request) {
  try {
    const command = taskCommandFrom(request);
    if (command === "listen") {
      return taskEventStreamResponse();
    }
    if (command === "list") {
      return NextResponse.json({ tasks: await readTasks() });
    }
    return documentationResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read reminders" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await taskBodyFromRequest(request);
    return await runJsonCommand(taskCommandFrom(request, body), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reminder command failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await taskBodyFromRequest(request);
    return await runJsonCommand(taskCommandFrom(request, { ...body, command: body.command ?? "update" }), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reminder update failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await taskBodyFromRequest(request);
    return await runJsonCommand(taskCommandFrom(request, { ...body, command: body.command ?? "remove" }), body, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reminder removal failed", docs: taskCommandDocs },
      { status: 400 },
    );
  }
}
