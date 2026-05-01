import { NextResponse } from "next/server";
import { addTask, deleteTasks, readTasks, updateTask } from "../../../../lib/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRpcRequest = {
  id?: string | number | null;
  jsonrpc?: "2.0";
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id: string | number | null;
  jsonrpc: "2.0";
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

const serverInfo = {
  name: "nova-dashboard-tasks",
  version: "1.0.0",
};

const tools = [
  {
    name: "nova_tasks_list",
    description: "List Nova dashboard tasks.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "nova_tasks_listen",
    description: "Return the SSE endpoint for live task updates.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "nova_tasks_add",
    description: "Add a local Nova dashboard task.",
    inputSchema: {
      type: "object",
      required: ["name", "start"],
      properties: {
        name: { type: "string" },
        start: { type: "string", description: "ISO date/time or parseable date/time string." },
        end: { type: ["string", "null"], description: "Optional task end. Null creates reminder-only task." },
        repeat: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              required: ["kind"],
              properties: {
                kind: { enum: ["hourly", "morning-night"] },
              },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["kind", "intervalDays"],
              properties: {
                kind: { const: "days" },
                intervalDays: { type: "integer", minimum: 1, maximum: 365 },
              },
              additionalProperties: false,
            },
          ],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nova_tasks_update",
    description: "Update a local Nova dashboard task.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        start: { type: "string" },
        end: { type: ["string", "null"] },
        repeat: { type: ["object", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nova_tasks_remove",
    description: "Remove one or more Nova dashboard tasks.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ids: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function response(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    id: id ?? null,
    jsonrpc: "2.0",
    result,
  };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return {
    id: id ?? null,
    jsonrpc: "2.0",
    error: { code, message },
  };
}

function argsFrom(params: Record<string, unknown> | undefined) {
  const args = params?.arguments;
  return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
}

function updatePatchFrom(args: Record<string, unknown>) {
  const patch: { name?: unknown; start?: unknown; end?: unknown; repeat?: unknown } = {};
  for (const key of ["name", "start", "end", "repeat"] as const) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      patch[key] = args[key];
    }
  }
  return patch;
}

function idsFrom(args: Record<string, unknown>) {
  if (Array.isArray(args.ids)) {
    return args.ids.map(String).map((id) => id.trim()).filter(Boolean);
  }
  const id = String(args.id ?? "").trim();
  return id ? [id] : [];
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "nova_tasks_list") {
    return textResult({ tasks: await readTasks() });
  }
  if (name === "nova_tasks_listen") {
    return textResult({
      endpoint: "/api/tasks?command=listen",
      eventTypes: ["client-id", "tasks", "task-alert", "task-dismiss"],
    });
  }
  if (name === "nova_tasks_add") {
    const task = await addTask({
      name: args.name,
      start: args.start,
      end: args.end,
      repeat: args.repeat,
      source: "local",
    });
    return textResult(task);
  }
  if (name === "nova_tasks_update") {
    const id = String(args.id ?? "").trim();
    if (!id) {
      throw new Error("Task id is required");
    }
    return textResult(await updateTask(id, updatePatchFrom(args)));
  }
  if (name === "nova_tasks_remove") {
    const ids = idsFrom(args);
    if (!ids.length) {
      throw new Error("Task id is required");
    }
    await deleteTasks(ids);
    return textResult({ ok: true, removed: ids });
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!request.id && request.method?.startsWith("notifications/")) {
    return null;
  }

  if (request.method === "initialize") {
    return response(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo,
    });
  }
  if (request.method === "ping") {
    return response(request.id, {});
  }
  if (request.method === "tools/list") {
    return response(request.id, { tools });
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = String(params.name ?? "");
    return response(request.id, await callTool(name, argsFrom(params)));
  }

  return errorResponse(request.id, -32601, `Method not found: ${request.method ?? ""}`);
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/tasks/mcp",
    protocol: "MCP JSON-RPC over HTTP POST",
    serverInfo,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as JsonRpcRequest | JsonRpcRequest[];
    if (Array.isArray(payload)) {
      const results = (await Promise.all(payload.map(handleRequest))).filter(Boolean);
      return NextResponse.json(results);
    }

    const result = await handleRequest(payload);
    if (!result) {
      return new Response(null, { status: 204 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      errorResponse(null, -32603, error instanceof Error ? error.message : "MCP request failed"),
      { status: 400 },
    );
  }
}
