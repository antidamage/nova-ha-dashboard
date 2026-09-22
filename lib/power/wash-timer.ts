// The wash's timer, and the household timer it drives.
//
// Claiming a wash sets the one household timer — the same entry the set-timer
// control starts and the same `/api/orb-timer` state every screen reads — and
// the meter tick then grows or finishes it as the machine's power says. The
// countdown, the chime, the orb flash, the tap that dismisses it and the
// Discord message are all the timer's own machinery, so a wash is notified
// exactly as a user-set timer is, and the wash owns no sound path at all. See
// specs/power-meters.md, "The wash's timer".
import { readDashboardConfigSync } from "../dashboard-config";
import { cancelOrbTimer, completeOrbTimerAt, extendOrbTimer, setOrbTimer } from "../orb-timer";
import { normalizeTimerIcons, timerIconCode } from "../orb-timer-settings";
import { readDashboardPreferences } from "../preferences";
import { beginWashTimer, type WashingMachineOpenCycle, type WashTimer } from "../washing-machine";
import { powerConfig } from "./store";

/**
 * The household's own first timer icon: their list, their glyph, their label.
 * A list they have not configured falls back to the single default icon, the
 * same way the timer control resolves it.
 */
export function washTimerIcon(timerIcons: unknown) {
  const [icon] = normalizeTimerIcons(timerIcons);
  return { code: timerIconCode(icon.glyph), label: icon.label };
}

/**
 * Take a wash's unfinished timer off every screen, silently.
 *
 * A timer that has already finished is left alone: it is an alert waiting to be
 * acknowledged, and the wash ending is not an acknowledgement.
 */
async function releaseWashTimer(timer: WashTimer | undefined) {
  if (timer?.completedAt === null) await cancelOrbTimer(timer?.orbTimerId ?? null);
}

/**
 * The wash's timer for a claim that has just landed, or undefined for one that
 * starts nothing.
 *
 * Only a claim that lands on the **primary** person starts one, and a wash
 * that has already finished its timer starts none: its `completion` captured,
 * or its timer completed. Between that edge and the cycle closing the finished
 * wash is still on screen and still tappable, and a wash is notified once — a
 * countdown for one that is done must not replace the alert standing on the
 * household's screen. A timer the wash was still running is released first, so
 * a tap that takes the wash off the primary person leaves nothing sounding
 * behind it.
 */
export async function setWashTimer(cycle: WashingMachineOpenCycle, now: Date): Promise<WashTimer | undefined> {
  await releaseWashTimer(cycle.timer);
  const config = powerConfig().washingMachine;
  const primaryId = readDashboardConfigSync().dashboard.people.find((person) => person.primary)?.id;
  const finished = Boolean(cycle.completion) || Boolean(cycle.timer?.completedAt);
  if (!config || !primaryId || !cycle.startedAt || cycle.person !== primaryId || finished) return undefined;
  const timer = beginWashTimer(now.toISOString(), config.timer);
  const { code, label } = washTimerIcon((await readDashboardPreferences()).orbInfo?.timerIcons);
  const orb = await setOrbTimer(config.timer.firstPeriodMinutes * 60_000, code, label, { autoComplete: false });
  return { ...timer, orbTimerId: orb?.id ?? null };
}

/**
 * Mirror what a meter tick did to the wash's timer onto the household timer: an
 * extension grows it, a completion finishes it there and then, and an
 * unfinished timer that has gone away with its wash is cancelled silently.
 *
 * Nothing happens once the household timer is no longer the one this wash set.
 * They replaced it with a timer of their own, and a wash never takes it back.
 */
export async function syncWashTimer(before: WashTimer | undefined, after: WashTimer | undefined) {
  if (!after) {
    await releaseWashTimer(before);
    return;
  }
  if (!after.orbTimerId || before?.orbTimerId !== after.orbTimerId) return;
  if (after.completedAt !== null && before.completedAt === null) {
    await completeOrbTimerAt(after.orbTimerId, Date.parse(after.completedAt));
    return;
  }
  if (after.endsAt !== before.endsAt) await extendOrbTimer(after.orbTimerId, Date.parse(after.endsAt));
}
