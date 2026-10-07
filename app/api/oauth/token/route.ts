import { NextResponse } from "next/server";
import { authenticateClient } from "../../../../lib/oauth/clients";
import { clearFailures, recordFailure, throttleRetryAfter } from "../../../../lib/oauth/throttle";
import { issueToken, secretVersion } from "../../../../lib/oauth/tokens";

export const dynamic = "force-dynamic";

// OAuth 2.0 client-credentials grant (RFC 6749 section 4.4).
// Spec: specs/update-force-endpoint.md.
const MAX_BODY_CHARS = 4096;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json({ error, error_description: description }, { status, headers: { ...NO_STORE, ...extra } });
}

function basicCredentials(request: Request) {
  const match = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) {
    return null;
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) {
    return null;
  }
  try {
    return {
      id: decodeURIComponent(decoded.slice(0, colon)),
      secret: decodeURIComponent(decoded.slice(colon + 1)),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return oauthError("invalid_request", "Request body too large.", 400);
    }
    const form = new URLSearchParams(text);
    if (form.get("grant_type") !== "client_credentials") {
      return oauthError("unsupported_grant_type", "Only client_credentials is supported.", 400);
    }
    const credentials = basicCredentials(request) ?? {
      id: form.get("client_id") ?? "",
      secret: form.get("client_secret") ?? "",
    };
    if (!credentials.id || !credentials.secret) {
      return oauthError("invalid_request", "client_id and client_secret are required.", 400);
    }

    const retryAfter = throttleRetryAfter(credentials.id);
    if (retryAfter > 0) {
      return oauthError("invalid_client", "Too many failed attempts.", 429, { "Retry-After": String(retryAfter) });
    }
    const client = await authenticateClient(credentials.id, credentials.secret);
    if (!client) {
      recordFailure(credentials.id);
      return oauthError("invalid_client", "Client authentication failed.", 401, {
        "WWW-Authenticate": 'Basic realm="nova-oauth"',
      });
    }
    clearFailures(client.id);

    const requested = (form.get("scope") ?? "").split(/\s+/).filter(Boolean);
    const granted = requested.length ? requested : client.scopes;
    if (granted.some((scope) => !client.scopes.includes(scope))) {
      return oauthError("invalid_scope", "The client is not registered for a requested scope.", 400);
    }

    const { token, expiresIn } = await issueToken(client.id, granted, secretVersion(client.secretHash));
    return NextResponse.json(
      { access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: granted.join(" ") },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[oauth] token request failed", error);
    return oauthError("server_error", "Token request failed.", 503);
  }
}
