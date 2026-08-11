import { NextResponse } from "next/server";
import {
  applyClimateControlIntent,
  type ClimateControlIntent,
} from "../../../lib/climate-control";
import { buildDashboardState } from "../../../lib/ha";

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
  for (const key of ["temperature", "autoOnMinutes", "autoOffMinutes"] as const) {
    if (input[key] !== undefined) {
      const number = Number(input[key]);
      if (!Number.isFinite(number)) throw new Error(`${key} must be numeric`);
      intent[key] = number;
    }
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

export async function POST(request: Request) {
  try {
    await applyClimateControlIntent(parseIntent(await request.json()));
    return NextResponse.json(await buildDashboardState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Climate-control update failed" },
      { status: 400 },
    );
  }
}
