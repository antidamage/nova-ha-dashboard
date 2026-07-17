import { NextResponse } from "next/server";
import {
  errorResponse,
  handleMcpPayload,
  mcpServerMetadata,
  type JsonRpcRequest,
} from "../../../lib/mcp-dashboard";
import { readDashboardConfig } from "../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function allowedOrigin(origin: string, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return allowedOrigins.some((candidate) => {
      try {
        const allowed = new URL(candidate);
        return parsed.protocol === allowed.protocol && parsed.hostname === allowed.hostname;
      } catch {
        return origin === candidate;
      }
    });
  } catch {
    return false;
  }
}

async function authorize(request: Request) {
  const config = await readDashboardConfig();
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigin(origin, config.mcp.allowedOrigins)) {
    return { ok: false, status: 403, message: "Origin is not allowed for Nova Dashboard MCP." };
  }

  if (!config.mcp.requireBearerAuth) {
    return { ok: true };
  }

  const expected = process.env.NOVA_DASHBOARD_MCP_TOKEN?.trim();
  if (!expected) {
    return { ok: false, status: 503, message: "NOVA_DASHBOARD_MCP_TOKEN must be configured before MCP POST calls are accepted." };
  }
  if (bearerToken(request) !== expected) {
    return { ok: false, status: 401, message: "Invalid or missing MCP bearer token." };
  }

  return { ok: true };
}

export async function GET() {
  return NextResponse.json(mcpServerMetadata());
}

export async function POST(request: Request) {
  try {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      return NextResponse.json(errorResponse(null, -32001, authorization.message ?? "MCP request is not authorized"), {
        status: authorization.status ?? 401,
      });
    }

    const payload = await request.json() as JsonRpcRequest | JsonRpcRequest[];
    const result = await handleMcpPayload(payload);
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
