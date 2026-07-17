import { NextResponse } from "next/server";
import { publishVoiceSpeaking, type VoiceSpeakingEvent } from "../../../../lib/dashboard-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TIMINGS = 500;
const MAX_DURATION_MS = 10 * 60 * 1000;

function boundedMs(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.min(MAX_DURATION_MS, Math.round(parsed)));
}

function parseTimings(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const timings: number[] = [];
  for (const entry of value.slice(0, MAX_TIMINGS)) {
    const at = boundedMs(entry);
    if (at === undefined) {
      continue;
    }
    timings.push(at);
  }
  return timings.length ? timings : undefined;
}

// Nova-voice announces speech here the instant a spoken response starts and
// ends; the event fans out to every connected browser over the shared SSE
// stream so each client can raise its speaking orb with minimal latency.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const phase = body.phase === "start" || body.phase === "end" ? body.phase : null;
    const turnId = typeof body.turnId === "string" ? body.turnId.slice(0, 64) : "";
    if (!phase || !turnId) {
      return NextResponse.json({ error: "phase (start|end) and turnId are required" }, { status: 400 });
    }

    const event: VoiceSpeakingEvent = { phase, turnId };
    if (typeof body.satelliteId === "string") {
      event.satelliteId = body.satelliteId.slice(0, 64);
    }
    if (typeof body.roomId === "string") {
      event.roomId = body.roomId.slice(0, 64);
    }
    if (phase === "start") {
      event.timingsMs = parseTimings(body.timingsMs);
      event.estimatedDurationMs = boundedMs(body.estimatedDurationMs);
      event.audibleOffsetMs = boundedMs(body.audibleOffsetMs);
    } else {
      event.playedDurationMs = boundedMs(body.playedDurationMs);
    }

    publishVoiceSpeaking(event);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid speaking event" }, { status: 400 });
  }
}
