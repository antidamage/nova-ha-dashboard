import { buildDashboardState, haRest, setEntityAction, setZoneAction } from "./ha";
import { dashboardModuleStatuses } from "./state";
import { scaffoldDashboardConfig } from "./config-scaffold";
import { indexRegistry, readRegistrySnapshot } from "./ha/registry";
import {
  dashboardConfigJsonSchema,
  dryRunDashboardConfigImport,
  exportDashboardConfig,
  patchDashboardConfig,
  readDashboardConfig,
  readSecretSetupStatus,
  writeDashboardConfig,
} from "./dashboard-config";
import { addTask, deleteTasks, readTasks, updateTask } from "./tasks";
import type { DashboardConfig, McpToolResult } from "./config-schema";
import type { HaDomain, HaState } from "./types";
import {
  errorResponse,
  response,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./mcp/protocol";

export { errorResponse, type JsonRpcRequest, type JsonRpcResponse };

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

const serverInfo = {
  name: "nova-dashboard",
  version: "1.0.0",
};

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
};

const confirmSchema = {
  confirm: {
    type: "boolean",
    description: "Required true for mutating tools.",
  },
};

const tools: ToolDefinition[] = [
  {
    name: "nova.config.get",
    title: "Read dashboard config",
    description: "Return the active portable Nova dashboard configuration with secrets excluded.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.config.export",
    title: "Export dashboard config",
    description: "Return a portable dashboard config export with runtime secrets excluded.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.config.schema",
    title: "Read dashboard config schema",
    description: "Return the JSON Schema for portable Nova dashboard configuration imports.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.config.validate",
    title: "Validate dashboard config",
    description: "Dry-run a dashboard configuration import and return validation diagnostics.",
    inputSchema: {
      type: "object",
      required: ["config"],
      properties: {
        config: { type: "object" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.config.apply",
    title: "Apply dashboard config",
    description: "Validate and write a portable dashboard configuration to the runtime config file.",
    inputSchema: {
      type: "object",
      required: ["config", "confirm"],
      properties: {
        config: { type: "object" },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.config.scaffold",
    title: "Scaffold config from Home Assistant",
    description:
      "Inspect the live Home Assistant instance and return a proposed dashboard config plus HA-side suggestions (labels, area sensor bindings). Review, adjust, then apply with nova.config.patch.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.config.patch",
    title: "Patch dashboard config",
    description:
      "Deep-merge a partial config onto the current config and write it. Lets an agent configure one module at a time instead of sending the whole document.",
    inputSchema: {
      type: "object",
      required: ["patch", "confirm"],
      properties: {
        patch: { type: "object" },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.setup.status",
    title: "Read setup status",
    description: "Return which required runtime secrets are configured without exposing their values.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.dashboard.health",
    title: "Read dashboard health",
    description: "Check config validity, setup status, Home Assistant connectivity, and task store health.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.dashboard.state",
    title: "Read dashboard state",
    description: "Return the current dashboard state built from Home Assistant.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.modules.status",
    title: "Read module status",
    description:
      "List dashboard modules, whether each is active for this home, and any unmet Home Assistant requirements. The agent-deploy checklist.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.ha.discover",
    title: "Discover Home Assistant entities",
    description: "Return Home Assistant entity states for agent-assisted configuration.",
    inputSchema: {
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string" },
        },
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.zone.action",
    title: "Control a dashboard zone",
    description: "Run a Nova dashboard zone action such as on, off, brightness, color, candlelight, or white.",
    inputSchema: {
      type: "object",
      required: ["zoneId", "action", "confirm"],
      properties: {
        zoneId: { type: "string" },
        action: { enum: ["on", "off", "brightness", "color", "candlelight", "white"] },
        brightnessPct: { type: "number", minimum: 0, maximum: 100 },
        rgb: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 255 },
          minItems: 3,
          maxItems: 3,
        },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.entity.action",
    title: "Control a Home Assistant entity",
    description: "Run an allowed Home Assistant entity action through the Nova dashboard safety layer.",
    inputSchema: {
      type: "object",
      required: ["entityId", "domain", "service", "confirm"],
      properties: {
        entityId: { type: "string" },
        domain: { enum: ["light", "switch", "climate", "fan", "cover", "humidifier"] },
        service: { type: "string" },
        data: { type: "object" },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.tasks.list",
    title: "List dashboard tasks",
    description: "List Nova dashboard tasks.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.tasks.listen",
    title: "Get task event stream",
    description: "Return the SSE endpoint for live task updates.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "nova.tasks.add",
    title: "Add dashboard task",
    description: "Add a local Nova dashboard task.",
    inputSchema: {
      type: "object",
      required: ["name", "start", "confirm"],
      properties: {
        name: { type: "string" },
        start: { type: "string" },
        end: { type: ["string", "null"] },
        repeat: { type: ["object", "null"] },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.tasks.update",
    title: "Update dashboard task",
    description: "Update a local Nova dashboard task.",
    inputSchema: {
      type: "object",
      required: ["id", "confirm"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        start: { type: "string" },
        end: { type: ["string", "null"] },
        repeat: { type: ["object", "null"] },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "nova.tasks.remove",
    title: "Remove dashboard tasks",
    description: "Remove one or more local Nova dashboard tasks.",
    inputSchema: {
      type: "object",
      required: ["confirm"],
      properties: {
        id: { type: "string" },
        ids: {
          type: "array",
          items: { type: "string" },
        },
        ...confirmSchema,
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
];

const resources = [
  {
    uri: "nova://dashboard/config/schema",
    name: "Dashboard Config Schema",
    description: "JSON Schema for portable Nova dashboard config.",
    mimeType: "application/schema+json",
  },
  {
    uri: "nova://dashboard/config/current",
    name: "Current Dashboard Config",
    description: "Current portable dashboard config with secrets excluded.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/setup/checklist",
    name: "Setup Checklist",
    description: "Runtime secret and setup status checklist.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/home-assistant/entities",
    name: "Home Assistant Entities",
    description: "Current Home Assistant states available to the dashboard.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/modules/status",
    name: "Module Status",
    description: "Dashboard modules, whether active, and unmet Home Assistant requirements.",
    mimeType: "application/json",
  },
];

const prompts = [
  {
    name: "nova.setup.wizard",
    title: "Nova setup wizard",
    description: "Guide a new user through configuring Nova Dashboard safely.",
  },
  {
    name: "nova.config.review",
    title: "Nova config review",
    description: "Review an imported Nova Dashboard config before applying it.",
  },
  {
    name: "nova.deployment.check",
    title: "Nova deployment check",
    description: "Verify deployment health after install or config changes.",
  },
];

export function mcpServerMetadata() {
  return {
    endpoint: "/api/mcp",
    protocol: "MCP JSON-RPC over Streamable HTTP-compatible POST",
    serverInfo,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
    resources,
    prompts,
  };
}

function textResult(value: unknown, isError = false): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    isError: isError || undefined,
    structuredContent: typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined,
  };
}

function argsFrom(params: Record<string, unknown> | undefined) {
  const args = params?.arguments;
  return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
}

function assertConfirmed(name: string, args: Record<string, unknown>, config: DashboardConfig) {
  if (!config.mcp.enableMutations) {
    throw new Error(`Mutating MCP tool is disabled by dashboard config: ${name}`);
  }
  if (config.mcp.mutatingToolsRequireConfirm && args.confirm !== true) {
    throw new Error(`MCP tool ${name} requires confirm: true`);
  }
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

function rgbTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const rgb = value.map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return rgb.every(Number.isFinite) ? rgb as [number, number, number] : undefined;
}

async function dashboardHealth() {
  const [config, secrets, tasksResult, stateResult] = await Promise.allSettled([
    exportDashboardConfig(),
    readSecretSetupStatus(),
    readTasks(),
    buildDashboardState(),
  ]);

  return {
    config: config.status === "fulfilled" ? { ok: true, schemaVersion: config.value.schemaVersion } : { ok: false, error: config.reason?.message },
    homeAssistant: stateResult.status === "fulfilled"
      ? { ok: true, generatedAt: stateResult.value.generatedAt, zones: stateResult.value.zones.length, entities: stateResult.value.entities.length }
      : { ok: false, error: stateResult.reason?.message ?? "State read failed" },
    secrets: secrets.status === "fulfilled" ? secrets.value : null,
    tasks: tasksResult.status === "fulfilled" ? { ok: true, count: tasksResult.value.length } : { ok: false, error: tasksResult.reason?.message },
  };
}

async function discoverHa(args: Record<string, unknown>) {
  const [states, registry] = await Promise.all([haRest<HaState[]>("/api/states"), readRegistrySnapshot()]);
  const index = indexRegistry(registry);
  const domains = new Set(Array.isArray(args.domains) ? args.domains.map(String) : []);
  const search = String(args.search ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Math.round(Number(args.limit ?? 120))));

  return {
    // Areas, including HA-native sensor bindings the dashboard reads directly.
    areas: registry.areas.map((area) => ({
      id: area.id,
      name: area.name,
      temperature_entity_id: area.temperature_entity_id ?? null,
      humidity_entity_id: area.humidity_entity_id ?? null,
    })),
    labels: registry.labels.map((label) => ({ id: label.label_id, name: label.name })),
    entities: states
      .filter((state) => !domains.size || domains.has(state.entity_id.split(".")[0]))
      .filter((state) => {
        if (!search) {
          return true;
        }
        const friendlyName = typeof state.attributes.friendly_name === "string" ? state.attributes.friendly_name : "";
        return `${state.entity_id} ${friendlyName}`.toLowerCase().includes(search);
      })
      .slice(0, limit)
      .map((state) => {
        const reg = index.entityById.get(state.entity_id);
        const device = reg?.device_id ? index.deviceById.get(reg.device_id) : undefined;
        return {
          entity_id: state.entity_id,
          state: state.state,
          friendly_name: state.attributes.friendly_name ?? null,
          device_class: state.attributes.device_class ?? null,
          unit_of_measurement: state.attributes.unit_of_measurement ?? null,
          area_id: reg?.area_id ?? device?.area_id ?? null,
          entity_category: reg?.entity_category ?? null,
          labels: reg?.labels ?? [],
        };
      }),
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const config = await readDashboardConfig();

  if (name === "nova.config.get" || name === "nova.config.export") {
    return textResult({ config: await exportDashboardConfig() });
  }
  if (name === "nova.config.schema") {
    return textResult({ schema: dashboardConfigJsonSchema() });
  }
  if (name === "nova.config.validate") {
    return textResult(await dryRunDashboardConfigImport(args.config));
  }
  if (name === "nova.config.apply") {
    assertConfirmed(name, args, config);
    return textResult(await writeDashboardConfig(args.config));
  }
  if (name === "nova.config.scaffold") {
    return textResult(await scaffoldDashboardConfig());
  }
  if (name === "nova.config.patch") {
    assertConfirmed(name, args, config);
    return textResult(await patchDashboardConfig(args.patch));
  }
  if (name === "nova.setup.status") {
    return textResult(await readSecretSetupStatus());
  }
  if (name === "nova.dashboard.health") {
    return textResult(await dashboardHealth());
  }
  if (name === "nova.dashboard.state") {
    return textResult(await buildDashboardState());
  }
  if (name === "nova.modules.status") {
    return textResult({ modules: await dashboardModuleStatuses() });
  }
  if (name === "nova.ha.discover") {
    return textResult(await discoverHa(args));
  }
  if (name === "nova.zone.action") {
    assertConfirmed(name, args, config);
    return textResult(await setZoneAction({
      action: String(args.action ?? "") as "on" | "off" | "brightness" | "color" | "candlelight" | "white",
      brightnessPct: args.brightnessPct === undefined ? undefined : Number(args.brightnessPct),
      rgb: rgbTuple(args.rgb),
      zoneId: String(args.zoneId ?? ""),
    }));
  }
  if (name === "nova.entity.action") {
    assertConfirmed(name, args, config);
    return textResult(await setEntityAction({
      data: args.data && typeof args.data === "object" && !Array.isArray(args.data) ? args.data as Record<string, unknown> : {},
      domain: String(args.domain ?? "") as HaDomain,
      entityId: String(args.entityId ?? ""),
      service: String(args.service ?? ""),
    }));
  }
  if (name === "nova.tasks.list" || name === "nova_tasks_list") {
    return textResult({ tasks: await readTasks() });
  }
  if (name === "nova.tasks.listen" || name === "nova_tasks_listen") {
    return textResult({
      endpoint: "/api/tasks?command=listen",
      eventTypes: ["client-id", "tasks", "task-alert", "task-dismiss"],
    });
  }
  if (name === "nova.tasks.add" || name === "nova_tasks_add") {
    assertConfirmed(name, args, config);
    return textResult(await addTask({
      end: args.end,
      name: args.name,
      repeat: args.repeat,
      source: "local",
      start: args.start,
    }));
  }
  if (name === "nova.tasks.update" || name === "nova_tasks_update") {
    assertConfirmed(name, args, config);
    const id = String(args.id ?? "").trim();
    if (!id) {
      throw new Error("Task id is required");
    }
    return textResult(await updateTask(id, updatePatchFrom(args)));
  }
  if (name === "nova.tasks.remove" || name === "nova_tasks_remove") {
    assertConfirmed(name, args, config);
    const ids = idsFrom(args);
    if (!ids.length) {
      throw new Error("Task id is required");
    }
    await deleteTasks(ids);
    return textResult({ ok: true, removed: ids });
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function readResource(uri: string) {
  if (uri === "nova://dashboard/config/schema") {
    return { uri, mimeType: "application/schema+json", text: JSON.stringify(dashboardConfigJsonSchema(), null, 2) };
  }
  if (uri === "nova://dashboard/config/current") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await exportDashboardConfig(), null, 2) };
  }
  if (uri === "nova://dashboard/setup/checklist") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await readSecretSetupStatus(), null, 2) };
  }
  if (uri === "nova://dashboard/home-assistant/entities") {
    return { uri, mimeType: "application/json", text: JSON.stringify(await discoverHa({ limit: 300 }), null, 2) };
  }
  if (uri === "nova://dashboard/modules/status") {
    return { uri, mimeType: "application/json", text: JSON.stringify({ modules: await dashboardModuleStatuses() }, null, 2) };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function promptMessages(name: string) {
  if (name === "nova.setup.wizard") {
    return "Deploy Nova into this home: 1) nova.setup.status for required secrets; 2) nova.config.scaffold to propose config from live Home Assistant and surface HA-side suggestions (labels, area sensor bindings); 3) apply HA-side suggestions where possible, then nova.config.patch (confirm: true) one module at a time; 4) nova.modules.status to see which modules are active and what is still missing; 5) nova.dashboard.health to verify. Keep secrets in the runtime environment, never in portable config.";
  }
  if (name === "nova.config.review") {
    return "Review the proposed Nova Dashboard config against the schema and current Home Assistant entity snapshot. Flag missing secrets separately and do not include tokens or passwords in portable config.";
  }
  if (name === "nova.deployment.check") {
    return "Check Nova Dashboard health, setup status, current config version, task store, and Home Assistant connectivity. Recommend only the smallest safe corrective action.";
  }
  throw new Error(`Unknown prompt: ${name}`);
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!request.id && request.method?.startsWith("notifications/")) {
    return null;
  }

  if (request.method === "initialize") {
    return response(request.id, {
      protocolVersion: "2025-11-25",
      capabilities: {
        prompts: {},
        resources: {},
        tools: {
          listChanged: false,
        },
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
    try {
      return response(request.id, await callTool(name, argsFrom(params)));
    } catch (error) {
      return response(request.id, textResult(error instanceof Error ? error.message : "Tool call failed", true));
    }
  }
  if (request.method === "resources/list") {
    return response(request.id, { resources });
  }
  if (request.method === "resources/read") {
    const uri = String(request.params?.uri ?? "");
    return response(request.id, { contents: [await readResource(uri)] });
  }
  if (request.method === "prompts/list") {
    return response(request.id, { prompts });
  }
  if (request.method === "prompts/get") {
    const name = String(request.params?.name ?? "");
    return response(request.id, {
      description: prompts.find((prompt) => prompt.name === name)?.description ?? name,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: promptMessages(name),
          },
        },
      ],
    });
  }

  return errorResponse(request.id, -32601, `Method not found: ${request.method ?? ""}`);
}

export async function handleMcpPayload(payload: JsonRpcRequest | JsonRpcRequest[]) {
  if (Array.isArray(payload)) {
    return (await Promise.all(payload.map(handleMcpRequest))).filter(Boolean);
  }
  return handleMcpRequest(payload);
}
