import { describe, expect, it } from "vitest";
import { readDefaultDashboardConfig } from "./dashboard-config";
import { handleMcpRequest, mcpServerMetadata } from "./mcp-dashboard";

describe("dashboard MCP descriptors", () => {
  it("advertises dashboard-wide tools and resources", () => {
    const metadata = mcpServerMetadata();

    expect(metadata.endpoint).toBe("/api/mcp");
    const toolNames = metadata.tools.map((tool) => tool.name);
    expect(toolNames).toContain("nova.config.validate");
    expect(toolNames).toContain("nova.dashboard.health");
    expect(toolNames).toContain("nova.modules.status");
    expect(toolNames).toContain("nova.config.scaffold");
    expect(toolNames).toContain("nova.config.patch");
    expect(metadata.resources.map((resource) => resource.uri)).toContain("nova://dashboard/config/schema");
    expect(metadata.resources.map((resource) => resource.uri)).toContain("nova://dashboard/modules/status");
  });

  it("requires confirmation for config patch", async () => {
    const response = await handleMcpRequest({
      id: 4,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "nova.config.patch",
        arguments: { patch: { homeAssistant: { networkZoneId: "network" } } },
      },
    });

    expect(response?.error?.message ?? JSON.stringify(response?.result)).toContain("confirm");
  });

  it("initializes with tool, resource, and prompt capabilities", async () => {
    const response = await handleMcpRequest({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
    });

    expect(response?.result).toMatchObject({
      protocolVersion: "2025-11-25",
      capabilities: {
        prompts: {},
        resources: {},
        tools: { listChanged: false },
      },
    });
  });

  it("validates config through a tool call", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    const response = await handleMcpRequest({
      id: 2,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "nova.config.validate",
        arguments: {
          config: defaultConfig,
        },
      },
    });

    expect(response?.result).toMatchObject({
      structuredContent: {
        ok: true,
        applied: false,
      },
    });
  });

  it("requires confirmation for config apply", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    const response = await handleMcpRequest({
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "nova.config.apply",
        arguments: {
          config: defaultConfig,
        },
      },
    });

    expect(response?.error?.message ?? JSON.stringify(response?.result)).toContain("confirm");
  });
});
