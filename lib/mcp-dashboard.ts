/**
 * Local MCP server — facade. The body lives in lib/mcp-dashboard/; this file
 * keeps the import path stable for its callers (specs/agent-token-footprint.md
 * §3.3). specs/mcp-and-agent-interface.md owns the contract.
 *
 *   mcp-dashboard/types.ts        tool definition shape
 *   mcp-dashboard/constants.ts    server info, schema fragments, resources, prompts
 *   mcp-dashboard/tools.ts        the tool catalogue
 *   mcp-dashboard/args-model.ts   result wrapping, argument readers, confirm gate
 *   mcp-dashboard/call-tool.ts    tool and resource dispatch
 *   mcp-dashboard/server.ts       JSON-RPC methods, metadata, batch payloads
 */
export { errorResponse, handleMcpPayload, handleMcpRequest, mcpServerMetadata } from "./mcp-dashboard/server";
export type { JsonRpcRequest, JsonRpcResponse } from "./mcp-dashboard/server";
