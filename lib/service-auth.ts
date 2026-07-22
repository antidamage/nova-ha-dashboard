import { timingSafeEqual } from "node:crypto";

function bearerToken(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1]?.trim() ?? "";
}

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeDashboardServiceRequest(request: Request) {
  const expected = process.env.NOVA_DASHBOARD_MCP_TOKEN?.trim() ?? "";
  if (!expected) {
    return { ok: false as const, status: 503, message: "Dashboard service token is not configured." };
  }
  if (!equalSecret(bearerToken(request), expected)) {
    return { ok: false as const, status: 401, message: "Invalid or missing service bearer token." };
  }
  return { ok: true as const, status: 200, message: "" };
}
