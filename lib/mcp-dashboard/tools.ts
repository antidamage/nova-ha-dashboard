// The MCP tool catalogue: one table, listed verbatim by tools/list.
import { confirmSchema, emptyInputSchema } from "./constants";
import type { ToolDefinition } from "./types";

export const tools: ToolDefinition[] = [
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
        follows: { type: ["object", "null"] },
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
        follows: { type: ["object", "null"] },
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
