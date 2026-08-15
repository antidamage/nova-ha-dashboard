import { NextRequest, NextResponse } from "next/server";
import {
  cancelVoiceHostAgentGoal,
  createVoiceHostDelegationGrant,
  fetchVoiceHostAgentAdministration,
  revokeVoiceHostDelegationGrant,
  setVoiceHostAgentIdentityRole,
} from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const payload = await fetchVoiceHostAgentAdministration();
  return payload
    ? NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Voice agent administration is unavailable" }, { status: 502 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid administration request" }, { status: 400 });
  }
  const action = body.action;
  let result;
  if (action === "set-role" && typeof body.personId === "string" && typeof body.role === "string") {
    result = await setVoiceHostAgentIdentityRole(body.personId, body.role);
  } else if (action === "create-grant" && body.grant && typeof body.grant === "object") {
    result = await createVoiceHostDelegationGrant(body.grant as Record<string, unknown>);
  } else if (action === "revoke-grant" && typeof body.grantId === "string") {
    result = await revokeVoiceHostDelegationGrant(body.grantId);
  } else if (action === "cancel-goal" && typeof body.goalId === "string") {
    result = await cancelVoiceHostAgentGoal(
      body.goalId,
      typeof body.reason === "string" ? body.reason : "cancelled by household owner",
    );
  } else {
    return NextResponse.json({ error: "Unsupported administration action" }, { status: 400 });
  }
  if ("payload" in result) {
    return NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
