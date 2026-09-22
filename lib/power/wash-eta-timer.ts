// The washing machine's notification is an ordinary household timer.
//
// Claiming a wash sets the one household timer — the same entry the set-timer
// control starts and the same `/api/orb-timer` state every screen reads — for
// what is left of the primary person's typical wash. The countdown, the chime,
// the orb flash, the tap that dismisses it and the Discord message are then the
// timer's own, and no wash-specific sound path exists at all. See
// specs/power-meters.md, "The wash's timer".
import { readDashboardConfigSync } from "../dashboard-config";
import type { WashingMachineOpenCycle } from "../washing-machine";
import { setOrbTimer } from "../orb-timer";
import { normalizeTimerIcons, timerIconCode } from "../orb-timer-settings";
import { readDashboardPreferences } from "../preferences";
import { powerConfig } from "./store";

/**
 * The household's own first timer icon: their list, their glyph, their label.
 * A list they have not configured falls back to the single default icon, the
 * same way the timer control resolves it.
 */
export function washEtaTimerIcon(timerIcons: unknown) {
  const [icon] = normalizeTimerIcons(timerIcons);
  return { code: timerIconCode(icon.glyph), label: icon.label };
}

/**
 * Start the wash's timer for the remainder of the primary person's typical
 * wash. Null — leaving any timer that is already running alone — when this claim
 * is not the primary person's, when the wash has already run past its typical
 * length, when its completion has already been captured, or when no typical
 * length is configured.
 */
export async function startWashEtaTimer(cycle: WashingMachineOpenCycle, now: Date) {
  const typicalMinutes = powerConfig().washingMachine?.typicalMinutes;
  const primaryId = readDashboardConfigSync().dashboard.people.find((person) => person.primary)?.id;
  if (!typicalMinutes || !primaryId || !cycle.startedAt || cycle.person !== primaryId) {
    return null;
  }
  // Between the completion edge and the cycle closing (endQuietSeconds) the
  // finished wash is still on screen and still tappable. A countdown for a wash
  // that is already done must not replace the household's timer.
  if (cycle.completion) {
    return null;
  }
  const remainingMs = typicalMinutes * 60_000 - (now.getTime() - Date.parse(cycle.startedAt));
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return null;
  }
  const { code, label } = washEtaTimerIcon((await readDashboardPreferences()).orbInfo?.timerIcons);
  return setOrbTimer(remainingMs, code, label);
}
