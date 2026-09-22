import type { WashingMachineConfig } from "../config-schema";
import { accumulateWashEnergy, creditWashEnergy } from "./energy-model";
import { advanceWashTimer, completeWashTimer } from "./timer-model";
import type { WashingMachineCycle, WashingMachineOpenCycle, WashingMachineState } from "./types";

/** Cycles older than this are dropped — a year plus change for comparison. */
export const WASHING_MACHINE_HISTORY_DAYS = 400;

export function blankWashingMachineState(): WashingMachineState {
  return { cycles: [], open: null, version: 1 };
}

function seconds(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

export function cycleId(startedAt: string) {
  return `${startedAt.replace(/[:.]/g, "-")}`;
}

/**
 * A wash nobody claimed belongs to the household's other person: it is not
 * evidence about the primary person, and the guess that used to fill the gap is
 * gone — the claim is the signal (specs/power-meters.md, "The wash's timer").
 */
function settleUnclaimed(cycle: WashingMachineCycle, config: WashingMachineConfig, at: string): WashingMachineCycle {
  if (cycle.person || !config.unclaimedPersonId) return cycle;
  return { ...cycle, attribution: { at, source: "auto" }, person: config.unclaimedPersonId };
}

/**
 * Fold one power sample into the cycle state.
 *
 * `elapsedHours` is how long the previous reading stood for; the caller applies
 * the same `maxIntegrationHours` gap guard the rest of the power integrator
 * uses, and passes 0 when the gap is too large to trust.
 */
export function recordWashingMachineSample(
  state: WashingMachineState,
  options: {
    at: string;
    config: WashingMachineConfig;
    costPerKwh: number;
    elapsedHours: number;
    watts: number;
    /** HA report time; repeated reads of the same cached report cannot advance the quiet timer. */
    reportedAt?: string;
    /**
     * Energy since the previous sample from a kWh counter. When given it
     * replaces the held-power integral; power then only drives detection.
     */
    energyKwh?: number;
  },
): WashingMachineState {
  const { at, config, costPerKwh, elapsedHours, watts } = options;
  const open: WashingMachineOpenCycle = state.open ?? {
    aboveSince: null,
    belowSince: null,
    costNzd: 0,
    kwh: 0,
    lastSampleAt: at,
    lastWatts: watts,
    startedAt: null,
  };

  /**
   * Arm a wake: a fresh record (the meter leaving the off floor) or a rise above
   * `startWatts` (`byRise`). A wake the machine has outlived is not re-armed in
   * the dead band, and every arming starts the below-start count from zero.
   */
  function armWake(byRise: boolean) {
    if (open.startedAt) return;
    const stands = open.wokeAt !== undefined && open.wokeAt !== null;
    const outlived = open.wokeAt === null;
    if (stands || (outlived && !byRise)) return;
    open.wokeAt = at;
    delete open.belowStartSeconds;
  }

  accumulateWashEnergy(open, { costPerKwh, elapsedHours, energyKwh: options.energyKwh });
  const gap = seconds(open.lastSampleAt, at);
  const alert = config.completionAlert;
  const stop = config.timer;
  // A gap the ticks cannot span is no evidence about a quiet window, for the
  // close timer or for the completion alike: both restart from the next sample.
  if (gap > stop.maxSampleGapSeconds || gap < 0) open.belowSince = null;
  // Nor about a wake: the gap may hold a whole wash nobody saw.
  if ((gap > stop.maxSampleGapSeconds || elapsedHours <= 0) && !open.startedAt && open.wokeAt) {
    open.wokeAt = null;
    delete open.preStartKwh;
    delete open.belowStartSeconds;
  }
  // The window that says "the machine has stopped" is watched while either the
  // wash's timer or the completion record still needs it, and both settle on the
  // same edge so the timer's chime and the notification describe one moment.
  const settled = Boolean(open.completion) && (open.timer === undefined || open.timer.completedAt !== null);
  const watching = Boolean(alert?.enabled) || Boolean(open.timer);
  if (watching && open.startedAt && !settled) {
    const reportedAt = options.reportedAt ?? at;
    const age = seconds(reportedAt, at);
    // The metering plugs report on change: once the machine settles at its quiet
    // draw the integration stops writing that entity, so `last_reported` freezes
    // at the instant of the drop and never moves again (measured on the live
    // Tuya cloud bridge 2026-09-22 — frozen at the drop for 26 minutes at 0 W,
    // with `homeassistant.update_entity` every 30 s not moving it either). A
    // report old enough to be stale therefore cannot anchor the quiet window —
    // that would backdate it to a moment nobody was watching — but it is not
    // grounds for discarding the window either: the value it carries is still
    // the meter's last word. The window is measured in observed sample time, the
    // same clock the close timer below uses, and each tick that observes the
    // quiet draw extends it.
    const fresh = Number.isFinite(age) && age >= -5 && age <= stop.maxSampleGapSeconds;
    if (gap < 0 || gap > stop.maxSampleGapSeconds || elapsedHours <= 0 || watts > stop.stopWatts) open.zeroSince = null;
    if (watts <= stop.stopWatts) {
      // A fresh report says when the drop actually happened; a stale one only
      // says the quiet draw is standing now, so the window starts at this sample.
      open.zeroSince ??= fresh ? reportedAt : at;
      if (open.kwh >= config.minCycleKwh && seconds(open.zeroSince, at) > stop.stopSeconds) {
        if (open.timer) open.timer = completeWashTimer(open.timer, at);
        // Record even an unclaimed finish: a later claim must never backfill an
        // alert. An unclaimed wash carries the household's other person.
        if (alert?.enabled && !open.completion) {
          if (!open.person && config.unclaimedPersonId) {
            open.person = config.unclaimedPersonId;
            open.attribution = { at, source: "auto" };
          }
          open.completion = { at, person: open.person ?? null, discord: alert.discord && open.person === alert.personId };
        }
      }
    }
  }
  // The wash's timer is never completed by its own clock: a period that runs out
  // while the machine is still drawing is extended instead (§ the timer model).
  if (open.timer) {
    const step = advanceWashTimer(open.timer, { at, config: stop, drawing: watts > stop.stopWatts });
    if (step.extended) open.timer = step.timer;
  }
  open.lastSampleAt = at;
  open.lastWatts = watts;

  if (watts > config.startWatts) {
    open.belowSince = null;
    if (!open.startedAt) {
      // The machine leaves the off floor before the drum turns — the door, the
      // panel, the fill — and the fill's own pauses drop back under startWatts,
      // so the rise alone cannot date the wash. The wake can: see startedAt.
      armWake(true);
      delete open.belowStartSeconds;
      open.aboveSince ??= at;
      if (seconds(open.aboveSince, at) >= config.startSustainedSeconds) {
        // startedAt is when the machine woke, not when the drum's second burst
        // confirmed it, so the fill and the first agitation stay in the cycle's
        // total — and so does the energy they drew, accumulated tick by tick
        // since the wake rather than estimated backwards from the last reading.
        open.startedAt = open.wokeAt ?? open.aboveSince;
        creditWashEnergy(open, open.preStartKwh ?? 0, costPerKwh);
        delete open.preStartKwh;
        delete open.wokeAt;
      }
    }
    return { ...state, open };
  }

  if (watts < config.endWatts) {
    // The off floor: a finished load, or nothing running. Only a reading this
    // low is silence — a wash's own pauses draw more (specs/power-meters.md).
    open.aboveSince = null;
    delete open.wokeAt;
    delete open.preStartKwh;
    delete open.belowStartSeconds;
    if (!open.startedAt) {
      // Off, with nothing pending: no record rather than a quiet timer for no wash.
      return { ...state, open: null };
    }
    open.belowSince ??= at;
    if (seconds(open.belowSince, at) >= config.endQuietSeconds) {
      const closed: WashingMachineCycle = {
        ...(open.attribution ? { attribution: open.attribution } : {}),
        costNzd: Math.round(open.costNzd * 10000) / 10000,
        // endedAt is when it dropped, not when the quiet window expired.
        endedAt: open.belowSince,
        id: cycleId(open.startedAt),
        kwh: Math.round(open.kwh * 100000) / 100000,
        person: open.person ?? null,
        completion: open.completion,
        startedAt: open.startedAt,
      };
      // Below the floor this was the machine's standby panel or a door-open
      // blip, not a wash. Drop it rather than filling the month with noise.
      const cycles = closed.kwh >= config.minCycleKwh
        ? [...state.cycles, settleUnclaimed(closed, config, at)]
        : state.cycles;
      return { ...state, cycles, open: null };
    }
    return { ...state, open };
  }

  // The dead band: a wash soaking or draining, or a machine sitting with its
  // panel lit. Neither detection timer advances — this is neither evidence a
  // wash has begun nor evidence one has finished, and the measured pauses run
  // long (§4.1). A pending wake survives a pause shorter than the rise a wash
  // itself takes, counted per pause, so a fill that dips several times is still
  // a fill; a wake the machine has outlived stays `null` rather than re-arming.
  open.aboveSince = null;
  open.belowSince = null;
  if (!open.startedAt) {
    armWake(false);
    // `undefined` means the count was cleared: that sample was not in this pause.
    const counted = open.belowStartSeconds;
    open.belowStartSeconds = counted === undefined ? 0 : counted + Math.max(0, gap);
    if (open.wokeAt && open.belowStartSeconds > config.startSustainedSeconds) {
      open.wokeAt = null;
      delete open.preStartKwh;
    }
  }
  // The record is kept while the meter is above the off floor (dropping it here
  // is what re-armed the wake every few minutes); the off floor above ends it.
  return { ...state, open };
}
