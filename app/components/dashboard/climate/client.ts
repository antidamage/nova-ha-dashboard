"use client";

import type { BedroomHeaterPreferences } from "../../../../lib/types";
import type { EntityActionInput } from "../../../../lib/aircon-control";
import type { EntityActionsHandler } from "./types";

// The control sound is a UX press acknowledgement, so any command that fires
// later than the gesture (debounce timers, off-timer expiry) must pass
// silent:true and let the press itself play the sound.
export function callClimateActions(
  actions: EntityActionInput[],
  onEntityActions: EntityActionsHandler,
  toast: string,
  options?: { silent?: boolean },
) {
  return onEntityActions(actions, toast, options);
}

async function postClimate(path: string, body: unknown, fallbackMessage: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? fallbackMessage);
  }
  return payload;
}

/** The aircon's sleep timer. The server enforces its expiry. */
export async function saveAirconTimer(offTimerEndsAt: string | null) {
  await postClimate("/api/aircon/timer", { offTimerEndsAt }, "Failed to update aircon timer");
}

/**
 * A target set while the unit is off: remembered for the next start, with no
 * command to a device the owner has switched off (specs/temperature-encoder.md).
 */
export async function saveAirconTarget(temperature: number) {
  await postClimate("/api/aircon/target", { temperature }, "Failed to update aircon target");
}

// A heater save that never completes used to leave the card showing a state the
// server did not have — tap Off, the POST hangs on a sleeping link, and the card
// reads "Off" indefinitely while the thermostat keeps running. Nothing timed the
// request out and nothing told the user. See
// specs/bedroom-heater-control-integrity.md §2.
const BEDROOM_HEATER_SAVE_TIMEOUT_MS = 8000;

/**
 * Returns what the server now holds, so the card can show that rather than what
 * was tapped. The two agree on a normal save; they diverge when the server
 * clamps a target, and they would diverge silently on any future server-side
 * adjustment. The card follows the server.
 */
export async function saveBedroomHeater(update: BedroomHeaterPreferences): Promise<BedroomHeaterPreferences> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BEDROOM_HEATER_SAVE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/bedroom-heater", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to update bedroom heater");
    }
    return (body?.bedroomHeater ?? {}) as BedroomHeaterPreferences;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      // Deliberately not "nothing was changed" — the request may well have
      // reached the server and been applied. Unconfirmed is the honest word,
      // and the card re-syncs from the server rather than guessing.
      throw new Error("Heater did not respond in time — its state is unconfirmed");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function savePanelHeaterTimer(offTimerEndsAt: string | null) {
  const response = await fetch("/api/panel-heater/timer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offTimerEndsAt }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Failed to update panel heater timer");
  }
}
