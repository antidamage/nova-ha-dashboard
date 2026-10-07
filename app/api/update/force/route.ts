import { NextResponse } from "next/server";
import { SCOPE_UPDATE_FORCE } from "../../../../lib/oauth/constants";
import { authorizeOAuthRequest } from "../../../../lib/oauth/guard";
import { getUpdateStatus, requestUpdate } from "../../../../lib/update";

export const dynamic = "force-dynamic";

// Queue an update now, for an OAuth client holding update:force.
// Spec: specs/update-force-endpoint.md.
export async function POST(request: Request) {
  try {
    const decision = await authorizeOAuthRequest(request, SCOPE_UPDATE_FORCE);
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error, error_description: decision.description },
        {
          status: decision.status,
          headers: {
            "WWW-Authenticate":
              decision.status === 401
                ? 'Bearer realm="nova-oauth"'
                : `Bearer realm="nova-oauth", error="insufficient_scope", scope="${SCOPE_UPDATE_FORCE}"`,
          },
        },
      );
    }

    let sha: string | undefined;
    try {
      const body = (await request.json()) as { sha?: string };
      if (typeof body.sha === "string" && /^[0-9a-f]{7,40}$/i.test(body.sha.trim())) {
        sha = body.sha.trim();
      }
    } catch {
      // No body is fine: the updater builds branch HEAD.
    }

    const status = await getUpdateStatus();
    if (status.busy) {
      return NextResponse.json({ error: `An update is already ${status.phase}.`, status }, { status: 409 });
    }
    const queued = await requestUpdate({ sha, requestedBy: `oauth:${decision.clientId}`.slice(0, 40) });
    return NextResponse.json({ queued, status: await getUpdateStatus() }, { status: 202 });
  } catch (error) {
    console.error("[update] force failed", error);
    return NextResponse.json({ error: "Failed to queue update." }, { status: 503 });
  }
}
