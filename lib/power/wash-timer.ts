// The wash's timer, and the household timer it drives.
//
// A wash running sets the one household timer — the same entry the set-timer
// control starts and the same `/api/orb-timer` state every screen reads — and
// the meter tick then grows or finishes it as the machine's power says. The
// countdown, the chime, the orb flash, the tap that dismisses it and the
// Discord message are all the timer's own machinery, so a wash is notified
// exactly as a user-set timer is, and the wash owns no sound path at all. See
// specs/power-meters.md, "The wash's timer".
import { readDashboardConfigSync } from "../dashboard-config";
import { cancelOrbTimer, completeOrbTimerAt, extendOrbTimer, readOrbTimer, setOrbTimer, setOrbTimerWashNotify } from "../orb-timer";
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

/** The primary person's id, or undefined when the household names none. */
function primaryPersonId() {
  return readDashboardConfigSync().dashboard.people.find((person) => person.primary)?.id;
}

/**
 * The wash's timer for a wash that has just been confirmed running, or
 * undefined where it starts none.
 *
 * Every wash counts down, whoever it belongs to; `notify` says whether finishing
 * will sound and announce, which only the primary person's does. A household
 * timer already standing — one of their own, or an alert waiting to be
 * acknowledged — is never replaced by a wash nobody asked to be told about: the
 * wash's timer then counts down on the washing entry alone.
 */
export async function startWashTimer(cycle: WashingMachineOpenCycle, now: Date): Promise<WashTimer | undefined> {
  const config = powerConfig().washingMachine;
  const finished = Boolean(cycle.completion) || Boolean(cycle.timer);
  if (!config || !cycle.startedAt || finished) return undefined;
  const timer = beginWashTimer(now.toISOString(), config.timer);
  const primaryId = primaryPersonId();
  const notify = Boolean(primaryId) && cycle.person === primaryId;
  const standing = await readOrbTimer();
  if (standing && standing.dismissedAt === null) return { ...timer, notify };
  const { code, label } = washTimerIcon((await readDashboardPreferences()).orbInfo?.timerIcons);
  const orb = await setOrbTimer(config.timer.firstPeriodMinutes * 60_000, code, label, { autoComplete: false, washNotify: notify });
  return { ...timer, notify, orbTimerId: orb?.id ?? null };
}

/**
 * The wash's timer after a claim has landed, or undefined where there is none.
 *
 * A wash already counting down keeps its countdown: the claim only decides
 * whether the end will notify, so taking the wash off the primary person quiets
 * it rather than cancelling it. A wash with no timer running — the household
 * replaced it, or the tick has not started one yet — starts one only for the
 * primary person, and not for a wash that has already finished: between that
 * edge and the cycle closing the finished wash is still tappable, and a
 * countdown for one that is done must not replace the alert standing on the
 * household's screen.
 */
export async function setWashTimer(cycle: WashingMachineOpenCycle, now: Date): Promise<WashTimer | undefined> {
  const config = powerConfig().washingMachine;
  const primaryId = primaryPersonId();
  const notify = Boolean(primaryId) && cycle.person === primaryId;
  const running = cycle.timer?.completedAt === null ? cycle.timer : undefined;
  if (running) {
    if (running.orbTimerId) await setOrbTimerWashNotify(running.orbTimerId, notify);
    return { ...running, notify };
  }
  const finished = Boolean(cycle.completion) || Boolean(cycle.timer?.completedAt);
  if (!config || !primaryId || !cycle.startedAt || !notify || finished) return undefined;
  const timer = beginWashTimer(now.toISOString(), config.timer);
  const { code, label } = washTimerIcon((await readDashboardPreferences()).orbInfo?.timerIcons);
  const orb = await setOrbTimer(config.timer.firstPeriodMinutes * 60_000, code, label, { autoComplete: false, washNotify: true });
  return { ...timer, notify, orbTimerId: orb?.id ?? null };
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
    // A wash nobody asked to be told about finishes quietly: its countdown goes
    // off every screen with no sound and no message.
    if (after.notify === false) await cancelOrbTimer(after.orbTimerId);
    else await completeOrbTimerAt(after.orbTimerId, Date.parse(after.completedAt));
    return;
  }
  if (after.endsAt !== before.endsAt) await extendOrbTimer(after.orbTimerId, Date.parse(after.endsAt));
}
