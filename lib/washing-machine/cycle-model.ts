import type { WashingMachineConfig } from "../config-schema";
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

  function add(kwh: number) {
    open.kwh += kwh;
    open.costNzd += kwh * costPerKwh;
  }

  // Integrate the PREVIOUS reading over the interval it actually stood for,
  // as the rest of the power integrator does. Only a running cycle
  // accumulates; standby draw between washes is not a wash.
  const counterKwh = options.energyKwh !== undefined && Number.isFinite(options.energyKwh) && options.energyKwh >= 0
    ? options.energyKwh
    : undefined;
  if (open.startedAt && counterKwh !== undefined) {
    add(counterKwh);
  } else if (open.startedAt && elapsedHours > 0) {
    add((open.lastWatts * elapsedHours) / 1000);
  } else if (!open.startedAt && counterKwh !== undefined && open.aboveSince) {
    open.preStartKwh = (open.preStartKwh ?? 0) + counterKwh;
  }
  const gap = seconds(open.lastSampleAt, at);
  const alert = config.completionAlert;
  const stop = config.timer;
  if (alert?.enabled && (gap > stop.maxSampleGapSeconds || gap < 0)) open.belowSince = null;
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
  const previousWatts = open.lastWatts;
  open.lastWatts = watts;

  if (watts > config.startWatts) {
    open.belowSince = null;
    open.aboveSince ??= at;
    if (!open.startedAt && seconds(open.aboveSince, at) >= config.startSustainedSeconds) {
      // startedAt is when the rise began, not when it was confirmed, so the
      // first two minutes of a wash are not lost from its total — and neither
      // is the energy it drew over them, credited here at the rate it has been
      // running at since.
      open.startedAt = open.aboveSince;
      if (counterKwh !== undefined) {
        // This tick's delta was already folded into preStartKwh above.
        add(open.preStartKwh ?? 0);
      } else {
        add((previousWatts * seconds(open.aboveSince, at)) / 3_600_000);
      }
      delete open.preStartKwh;
    }
    return { ...state, open };
  }

  if (watts < config.endWatts) {
    open.aboveSince = null;
    if (!open.startedAt) {
      // Idle, with nothing pending. Keep no open record rather than carrying a
      // quiet-timer that describes no wash.
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

  // In the dead band between the two thresholds — a wash idling between phases,
  // or a machine sitting with its panel lit. Neither timer advances: this is
  // neither evidence a wash has begun nor evidence one has finished.
  open.aboveSince = null;
  open.belowSince = null;
  return { ...state, open: open.startedAt ? open : null };
}
