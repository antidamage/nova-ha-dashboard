import { z } from "zod";

export const TaskRequestBodySchema = z.record(z.string(), z.unknown()).catch({});

export type TaskCommand = "add" | "delete" | "docs" | "list" | "listen" | "remove" | "update";

export async function taskBodyFromRequest(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return {};
  }

  const body = await request.json().catch(() => ({}));
  return TaskRequestBodySchema.parse(body);
}

export function taskCommandFrom(request: Request, body?: Record<string, unknown>): TaskCommand {
  const url = new URL(request.url);
  const command = String(url.searchParams.get("command") ?? body?.command ?? "").trim().toLowerCase();
  if (["add", "delete", "docs", "list", "listen", "remove", "update"].includes(command)) {
    return command as TaskCommand;
  }
  return "docs";
}

export function taskIdsFrom(value: unknown, fallback?: unknown) {
  const raw = value ?? fallback;
  if (Array.isArray(raw)) {
    return raw.map(String).map((id) => id.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  }
  return [];
}

export function taskUpdatePatchFrom(body: Record<string, unknown>) {
  const patch: { name?: unknown; start?: unknown; end?: unknown; repeat?: unknown } = {};
  for (const key of ["name", "start", "end", "repeat"] as const) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }
  return patch;
}

export function taskRoutePatchFrom(value: unknown) {
  const body = TaskRequestBodySchema.parse(value);
  const patch: { name: unknown; start: unknown; end: unknown; repeat?: unknown } = {
    name: body.name,
    start: body.start,
    end: body.end,
  };
  if (Object.prototype.hasOwnProperty.call(body, "repeat")) {
    patch.repeat = body.repeat;
  }
  return patch;
}

export function taskBulkReferenceDateFrom(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function taskBulkImportInput(value: unknown) {
  const body = TaskRequestBodySchema.parse(value);

  return {
    csv: String(body.csv ?? ""),
    referenceDate: taskBulkReferenceDateFrom(body.referenceDate),
  };
}
