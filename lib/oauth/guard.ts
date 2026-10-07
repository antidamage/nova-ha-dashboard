import { findActiveClient } from "./clients";
import { secretVersion, verifyToken } from "./tokens";

export type OAuthDecision =
  | { ok: true; clientId: string; scopes: string[] }
  | { ok: false; status: 401 | 403; error: "invalid_token" | "insufficient_scope"; description: string };

/**
 * The one call a route makes to require a scope. Checks the bearer token's
 * signature and expiry, that its client is still registered and not revoked, and
 * that the client holds `scope` right now, so narrowing a client's scopes also
 * takes effect on tokens already issued.
 */
export async function authorizeOAuthRequest(request: Request, scope: string): Promise<OAuthDecision> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const claims = match ? await verifyToken(match[1].trim()) : null;
  const client = claims ? await findActiveClient(claims.sub) : null;
  if (!claims || !client || claims.ver !== secretVersion(client.secretHash)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_token",
      description: "Missing, invalid, expired or revoked access token.",
    };
  }
  const held = claims.scope.split(" ").filter((granted) => client.scopes.includes(granted));
  if (!held.includes(scope)) {
    return {
      ok: false,
      status: 403,
      error: "insufficient_scope",
      description: `This token does not carry scope ${scope}.`,
    };
  }
  return { ok: true, clientId: client.id, scopes: held };
}
