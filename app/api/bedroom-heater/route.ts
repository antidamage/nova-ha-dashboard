import { NextResponse } from "next/server";
import {
  BEDROOM_HEATER_WINDOW_MAX_MINUTES,
  clampTargetTemperature,
  clampWindowMinutes,
} from "../../../lib/bedroom-heater-control";
import { applyClimateControlIntent, type ClimateControlIntent } from "../../../lib/climate-control";
import { readDashboardPreferences } from "../../../lib/preferences";
import type { BedroomHeaterPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";

function parseUpdate(body: unknown): BedroomHeaterPreferences {
  if (!body || typeof body !== "object") throw new Error("Expected a bedroom heater update object");
  const input = body as Record<string, unknown>;
  const update: BedroomHeaterPreferences = {};
  if (input.mode !== undefined) {
    const mode = String(input.mode) === "manual" ? "auto" : String(input.mode);
    if (mode !== "auto" && mode !== "off") throw new Error(`Unknown bedroom heater mode: ${mode}`);
    update.mode = mode;
  }
  if (input.temperature !== undefined) {
    const temperature = Number(input.temperature);
    if (!Number.isFinite(temperature)) throw new Error("Bedroom heater temperature must be a number");
    update.temperature = clampTargetTemperature(temperature);
  }
  for (const key of ["autoOnMinutes", "autoOffMinutes"] as const) {
    if (input[key] !== undefined) {
      const minutes = Number(input[key]);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > BEDROOM_HEATER_WINDOW_MAX_MINUTES) {
        throw new Error(`${key} must be between 0 and ${BEDROOM_HEATER_WINDOW_MAX_MINUTES}`);
      }
      update[key] = clampWindowMinutes(minutes);
    }
  }
  if (input.offTimerEndsAt !== undefined) {
    if (input.offTimerEndsAt === null) update.offTimerEndsAt = null;
    else {
      const endsAt = new Date(String(input.offTimerEndsAt));
      if (!Number.isFinite(endsAt.getTime())) throw new Error("offTimerEndsAt must be an ISO timestamp or null");
      update.offTimerEndsAt = endsAt.toISOString();
    }
  }
  return update;
}

export async function POST(request: Request) {
  try {
    const update = parseUpdate(await request.json());
    await applyClimateControlIntent({ room: "bedroom", ...update } as ClimateControlIntent);
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ bedroomHeater: preferences.bedroomHeater ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update bedroom heater" },
      { status: 400 },
    );
  }
}
