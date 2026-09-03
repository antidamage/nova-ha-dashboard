import { NextResponse } from "next/server";
import { clampTargetTemperature } from "../../../lib/bedroom-heater-control";
import {
  applyClimateControlIntent,
  type ClimateControlIntent,
} from "../../../lib/climate-control";
import { buildDashboardState } from "../../../lib/ha";
import { attributeControl } from "../../../lib/control-attribution";

export const dynamic = "force-dynamic";

function parseIntent(value: unknown): ClimateControlIntent {
  if (!value || typeof value !== "object") throw new Error("Expected a climate-control intent");
  const input = value as Record<string, unknown>;
  if (input.room !== "lounge" && input.room !== "bedroom") throw new Error("room must be lounge or bedroom");
  if (input.mode !== undefined && !["auto", "manual", "off"].includes(String(input.mode))) {
    throw new Error("mode must be auto, manual, or off");
  }
  if (input.direction !== undefined && !["heat", "cool", "fan_only"].includes(String(input.direction))) {
    throw new Error("direction must be heat, cool, or fan_only");
  }
  const intent: ClimateControlIntent = {
    room: input.room,
    ...(input.mode !== undefined ? { mode: input.mode as ClimateControlIntent["mode"] } : {}),
    ...(input.direction !== undefined ? { direction: input.direction as ClimateControlIntent["direction"] } : {}),
  };
  // No autoOnMinutes/autoOffMinutes: heaters have no clock schedule, so there
  // is nothing here a caller could set to make one turn itself on or off.
  if (input.temperature !== undefined) {
    const number = Number(input.temperature);
    if (!Number.isFinite(number)) throw new Error("temperature must be numeric");
    // Clamped here, not just in the card. This endpoint is the non-card path,
    // so an out-of-range target from any other caller used to land unbounded.
    intent.temperature = input.room === "bedroom" ? clampTargetTemperature(number) : number;
  }
  if (input.offTimerEndsAt !== undefined) {
    if (input.offTimerEndsAt === null) intent.offTimerEndsAt = null;
    else {
      const date = new Date(String(input.offTimerEndsAt));
      if (!Number.isFinite(date.getTime())) throw new Error("offTimerEndsAt must be an ISO timestamp or null");
      intent.offTimerEndsAt = date.toISOString();
    }
  }
  return intent;
}

/** One line for the activity panel and the Discord digest. */
function climateSummary(intent: ClimateControlIntent): string {
  const room = intent.room === "bedroom" ? "Bedroom heater" : "Lounge climate";
  if (intent.offTimerEndsAt) return `${room} sleep timer set`;
  if (intent.direction) return `${room} ${intent.direction}`;
  if (intent.mode && intent.temperature !== undefined) return `${room} ${intent.mode} at ${intent.temperature}`;
  if (intent.mode) return `${room} ${intent.mode}`;
  if (intent.temperature !== undefined) return `${room} to ${intent.temperature}`;
  return `${room} changed`;
}

export async function POST(request: Request) {
  try {
    const intent = parseIntent(await request.json());
    await applyClimateControlIntent(intent);
    void attributeControl(request, {
      service: intent.room === "bedroom" ? "heating" : "climate",
      event: "climate-intent",
      summary: climateSummary(intent),
      detail: {
        route: "/api/climate-control",
        room: intent.room,
        mode: intent.mode,
        direction: intent.direction,
        temperature: intent.temperature,
        offTimerEndsAt: intent.offTimerEndsAt,
      },
    });
    return NextResponse.json(await buildDashboardState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Climate-control update failed" },
      { status: 400 },
    );
  }
}
