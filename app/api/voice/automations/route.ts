import { NextRequest, NextResponse } from "next/server";
import {
  createIridiumAgentAutomation,
  feedbackIridiumProactiveIntervention,
  fetchIridiumAgentAutomations,
  fetchIridiumProactiveInterventions,
  transitionIridiumAgentAutomation,
} from "../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [automations, interventions] = await Promise.all([
    fetchIridiumAgentAutomations(),
    fetchIridiumProactiveInterventions(),
  ]);
  return automations && interventions
    ? NextResponse.json({ automations, interventions }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Voice automation administration is unavailable" }, { status: 502 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid automation request" }, { status: 400 });
  }
  let result;
  if (body.action === "draft" && typeof body.ownerId === "string" && body.draft && typeof body.draft === "object") {
    result = await createIridiumAgentAutomation(body.ownerId, body.draft as Record<string, unknown>);
  } else if (
    (body.action === "simulate" || body.action === "approve" || body.action === "activate" || body.action === "rollback")
    && typeof body.automationId === "string"
  ) {
    result = await transitionIridiumAgentAutomation(
      body.automationId,
      body.action,
      typeof body.ownerId === "string" ? body.ownerId : undefined,
    );
  } else if (
    body.action === "feedback"
    && typeof body.interventionId === "string"
    && typeof body.ownerId === "string"
    && (body.outcome === "accepted" || body.outcome === "dismissed" || body.outcome === "redundant" || body.outcome === "annoying")
  ) {
    result = await feedbackIridiumProactiveIntervention(
      body.interventionId,
      body.ownerId,
      body.outcome,
    );
  } else {
    return NextResponse.json({ error: "Unsupported automation request" }, { status: 400 });
  }
  return "payload" in result
    ? NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
