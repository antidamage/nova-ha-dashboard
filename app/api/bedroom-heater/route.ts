import { NextResponse } from "next/server";
import {
  BEDROOM_HEATER_WINDOW_MAX_MINUTES,
  bedroomHeaterMode,
  clampTargetTemperature,
  clampWindowMinutes,
} from "../../../lib/bedroom-heater-control";
import { publishDashboardState } from "../../../lib/dashboard-events";
import { buildDashboardState } from "../../../lib/ha";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import {
  bedroomSensorHasFreshReading,
  evaluateBedroomHeaterNow,
  noteBedroomHeaterUserCommand,
} from "../../../lib/bedroom-heater-auto";
import type { BedroomHeaterPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";

const MODES = new Set(["auto", "off"]);

function parseUpdate(body: unknown): BedroomHeaterPreferences {
  if (!body || typeof body !== "object") {
    throw new Error("Expected a bedroom heater update object");
  }
  const input = body as Record<string, unknown>;
  const update: BedroomHeaterPreferences = {};

  if (input.mode !== undefined) {
    // "manual" is retired but still accepted from an older client; it reads as
    // "auto" everywhere (see bedroomHeaterMode).
    const mode = String(input.mode) === "manual" ? "auto" : String(input.mode);
    if (!MODES.has(mode)) {
      throw new Error(`Unknown bedroom heater mode: ${mode}`);
    }
    update.mode = mode as BedroomHeaterPreferences["mode"];
  }

  if (input.temperature !== undefined) {
    const temperature = Number(input.temperature);
    if (!Number.isFinite(temperature)) {
      throw new Error("Bedroom heater temperature must be a number");
    }
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

  // null clears the sleep timer; a string sets it. Anything else is a bug in the
  // caller, not a value worth guessing at.
  if (input.offTimerEndsAt !== undefined) {
    if (input.offTimerEndsAt === null) {
      update.offTimerEndsAt = null;
    } else {
      const endsAt = new Date(String(input.offTimerEndsAt));
      if (!Number.isFinite(endsAt.getTime())) {
        throw new Error("offTimerEndsAt must be an ISO timestamp or null");
      }
      update.offTimerEndsAt = endsAt.toISOString();
    }
  }

  return update;
}

export async function POST(request: Request) {
  try {
    const update = parseUpdate(await request.json());

    if (update.mode === "auto" && !(await bedroomSensorHasFreshReading())) {
      throw new Error("Bedroom Auto is unavailable until the room sensor reports a fresh temperature");
    }

    // The server thermostat loop must stand down briefly after any user action,
    // for the same reason the aircon's client loop honours isPollingPaused():
    // a just-pressed Off must not be undone by a tick that was already deciding
    // from the pre-press snapshot.
    noteBedroomHeaterUserCommand();

    await mergeDashboardPreferences({
      bedroomHeater: { ...update, updatedAt: new Date().toISOString() },
    });
    try {
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish bedroom heater update", error);
    }

    const preferencesAfterWrite = await readDashboardPreferences();

    // Pressing Auto must do something now, not on the next poll. The card only
    // writes the mode; the thermostat decides what that means for the switch,
    // so ask it immediately rather than leaving the button looking dead.
    //
    // A new setpoint while already in Auto needs the same treatment, and needs
    // it more: without this it waits out the poll interval AND the ten-minute
    // minimum-cycle dwell, so raising the target on a cold room could leave the
    // heater off for ten minutes with no sign anything was heard. The dwell
    // guards against the loop short-cycling the relay, not against a person
    // deliberately asking for heat, and evaluateBedroomHeaterNow resets it.
    const nowInAuto = bedroomHeaterMode(preferencesAfterWrite.bedroomHeater) === "auto";
    if (update.mode === "auto" || (nowInAuto && update.temperature !== undefined)) {
      try {
        await evaluateBedroomHeaterNow();
      } catch (error) {
        console.error("[nova-dashboard] bedroom heater immediate evaluation failed", error);
      }
    }

    // Re-read: the evaluation above can itself write preferences (an expired
    // sleep timer flips the mode to off), so the reply must come from after it.
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ bedroomHeater: preferences.bedroomHeater ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update bedroom heater" },
      { status: 400 },
    );
  }
}
