import { NextResponse } from "next/server";
import {
  appendHouseholdEvent,
  HOUSEHOLD_EVENT_KINDS,
  householdEventLog,
  type HouseholdEventInput,
  type HouseholdEventKind,
  type HouseholdEventSource,
} from "../../../../lib/household-events";
import { authorizeDashboardServiceRequest } from "../../../../lib/service-auth";
import { ensureHouseholdEventBackboneStarted } from "../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCES: HouseholdEventSource[] = [
  "home_assistant",
  "dashboard",
  "calendar",
  "reminder",
  "agent_task",
];

function authorizationError(request: Request) {
  const authorization = authorizeDashboardServiceRequest(request);
  return authorization.ok
    ? null
    : NextResponse.json({ error: authorization.message }, { status: authorization.status });
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

export async function GET(request: Request) {
  const denied = authorizationError(request);
  if (denied) {
    return denied;
  }
  const url = new URL(request.url);
  ensureHouseholdEventBackboneStarted();
  const after = boundedInteger(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedInteger(url.searchParams.get("limit"), 200, 1, 1_000);
  return NextResponse.json(await householdEventLog.read(after, limit), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const denied = authorizationError(request);
  if (denied) {
    return denied;
  }
  try {
    const body = await request.json() as Partial<HouseholdEventInput>;
    if (
      !SOURCES.includes(body.source as HouseholdEventSource)
      || !HOUSEHOLD_EVENT_KINDS.includes(body.kind as HouseholdEventKind)
      || typeof body.occurredAt !== "string"
      || Number.isNaN(new Date(body.occurredAt).getTime())
      || typeof body.deduplicationKey !== "string"
      || !body.deduplicationKey.trim()
      || !body.payload
      || typeof body.payload !== "object"
      || Array.isArray(body.payload)
    ) {
      return NextResponse.json({ error: "Invalid normalized household event" }, { status: 400 });
    }
    const event = await appendHouseholdEvent(body as HouseholdEventInput);
    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to append household event" },
      { status: 400 },
    );
  }
}
