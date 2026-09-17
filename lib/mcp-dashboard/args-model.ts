// Pure: tool-result wrapping, argument reading and the mutation confirm gate.
import type { DashboardConfig, McpToolResult } from "../config-schema";

export function textResult(value: unknown, isError = false): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    isError: isError || undefined,
    structuredContent: typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined,
  };
}

export function argsFrom(params: Record<string, unknown> | undefined) {
  const args = params?.arguments;
  return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
}

export function assertConfirmed(name: string, args: Record<string, unknown>, config: DashboardConfig) {
  if (!config.mcp.enableMutations) {
    throw new Error(`Mutating MCP tool is disabled by dashboard config: ${name}`);
  }
  if (config.mcp.mutatingToolsRequireConfirm && args.confirm !== true) {
    throw new Error(`MCP tool ${name} requires confirm: true`);
  }
}

export function updatePatchFrom(args: Record<string, unknown>) {
  const patch: { name?: unknown; start?: unknown; end?: unknown; repeat?: unknown; follows?: unknown } = {};
  for (const key of ["name", "start", "end", "repeat", "follows"] as const) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      patch[key] = args[key];
    }
  }
  return patch;
}

export function idsFrom(args: Record<string, unknown>) {
  if (Array.isArray(args.ids)) {
    return args.ids.map(String).map((id) => id.trim()).filter(Boolean);
  }
  const id = String(args.id ?? "").trim();
  return id ? [id] : [];
}

export function rgbTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const rgb = value.map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return rgb.every(Number.isFinite) ? rgb as [number, number, number] : undefined;
}
