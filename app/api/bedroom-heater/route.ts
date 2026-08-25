import { NextResponse } from "next/server";
import { clampTargetTemperature } from "../../../lib/bedroom-heater-control";
import { applyClimateControlIntent, type ClimateControlIntent } from "../../../lib/climate-control";
import { emitDashboardEvent } from "../../../lib/event-spool";
import { readDashboardPreferences } from "../../../lib/preferences";
import { callerAttribution } from "../../../lib/request-attribution";
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
  // autoOnMinutes/autoOffMinutes are deliberately not accepted: the heater has
  // no clock schedule, and a caller must not be able to reinstate one.
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
    const caller = callerAttribution(request);
    await applyClimateControlIntent({ room: "bedroom", ...update } as ClimateControlIntent);
    const preferences = await readDashboardPreferences();
    // Attributed because this route is the heater's main writer and used to
    // leave no trace at all. See specs/bedroom-heater-control-integrity.md §4.
    void emitDashboardEvent({
      service: "heating",
      event: "bedroom-heater-update",
      source: "user",
      detail: {
        route: "/api/bedroom-heater",
        mode: update.mode,
        temperature: update.temperature,
        offTimerEndsAt: update.offTimerEndsAt,
        resultMode: preferences.bedroomHeater?.mode,
        resultTemperature: preferences.bedroomHeater?.temperature,
        callerIp: caller.ip,
        callerAgent: caller.userAgent,
      },
    });
    return NextResponse.json({ bedroomHeater: preferences.bedroomHeater ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update bedroom heater" },
      { status: 400 },
    );
  }
}
