// The JSON-RPC surface: initialize, tools, resources and prompts.
import {
  errorResponse,
  response,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../mcp/protocol";
import { argsFrom, textResult } from "./args-model";
import { callTool, readResource } from "./call-tool";
import { prompts, resources, serverInfo } from "./constants";
import { tools } from "./tools";

export { errorResponse, type JsonRpcRequest, type JsonRpcResponse };

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
