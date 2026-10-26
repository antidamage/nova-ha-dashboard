import { AIRCON_COMMAND_SETTLE_MS, OFF_RESEND_EVERY_MS, OFF_RESEND_MAX, OFF_RESEND_WINDOW_MS } from "./constants";
import type { PersistedRoom } from "./types";

/**
 * Record what the owner just selected, so an Off can be checked afterwards.
 * Any other selection withdraws it.
 */
export function noteOffRequest(room: PersistedRoom, mode: "auto" | "manual" | "off") {
  room.offRequestedAt = mode === "off" ? Date.now() : null;
  room.offResends = 0;
}

/**
 * Is the Off the owner pressed still unobeyed, so the loop should send it again?
 *
 * The Gree drops a command now and then, and an Off is a single `turn_off` with
 * nothing behind it: the selection says Off, the unit keeps running, and no
 * other rule looks at a unit that Off left alone (a unit running under Off is
 * otherwise read as somebody using the remote). So for two minutes after the
 * press, while the room is still Nova's, a unit that reports itself on gets the
 * `turn_off` again, at most every ten seconds and eight times in all.
 */
export function offNeedsResending(input: {
  room: Pick<PersistedRoom, "mode" | "owner" | "offRequestedAt" | "offResends" | "commandSettleUntil">;
  unitOn: boolean;
  now: number;
}): boolean {
  const { room, unitOn, now } = input;
  const requestedAt = room.offRequestedAt;
  if (room.mode !== "off" || room.owner !== "nova" || typeof requestedAt !== "number" || !unitOn) return false;
  if (now - requestedAt > OFF_RESEND_WINDOW_MS) return false;
  if ((room.offResends ?? 0) >= OFF_RESEND_MAX) return false;
  // Every command stamps the settle window, so its start is when the last one
  // went out; give the unit a few seconds before asking again.
  const lastSentAt = room.commandSettleUntil - AIRCON_COMMAND_SETTLE_MS;
  return now - Math.max(requestedAt, lastSentAt) >= OFF_RESEND_EVERY_MS;
}
