import type { WashingMachineOpenCycle } from "./types";

/*
 * The wash's energy. It lives beside `cycle-model.ts` rather than in it because
 * that file is at the size cap (specs/agent-token-footprint.md section 3).
 */

function add(open: WashingMachineOpenCycle, kwh: number, costPerKwh: number) {
  open.kwh += kwh;
  open.costNzd += kwh * costPerKwh;
}

/** Fold a measured amount into the running cycle, at this tick's rate. */
export function creditWashEnergy(open: WashingMachineOpenCycle, kwh: number, costPerKwh: number) {
  add(open, kwh, costPerKwh);
}

/**
 * Energy for one tick: the PREVIOUS reading held over the interval it actually
 * stood for, as the rest of the power integrator does. A running cycle
 * accumulates into the cycle; a rise still being confirmed accumulates into
 * `preStartKwh` instead, so the minutes between the machine waking and the
 * drum's first sustained burst are credited at what they drew rather than
 * estimated backwards from the last reading. A pending rise counts as pending
 * until it confirms, whether or not the wake that would date it survived: the
 * draw over those minutes happened, and a wash dated from its drum should keep
 * it. See specs/power-meters.md 4.1 and 7.3.
 */
export function accumulateWashEnergy(
  open: WashingMachineOpenCycle,
  options: { costPerKwh: number; elapsedHours: number; energyKwh?: number },
) {
  const counterKwh = options.energyKwh !== undefined && Number.isFinite(options.energyKwh) && options.energyKwh >= 0
    ? options.energyKwh
    : undefined;
  const pending = !open.startedAt && Boolean(open.wokeAt || open.aboveSince);
  if (open.startedAt && counterKwh !== undefined) {
    add(open, counterKwh, options.costPerKwh);
  } else if (open.startedAt && options.elapsedHours > 0) {
    add(open, (open.lastWatts * options.elapsedHours) / 1000, options.costPerKwh);
  } else if (pending && counterKwh !== undefined) {
    open.preStartKwh = (open.preStartKwh ?? 0) + counterKwh;
  } else if (pending && options.elapsedHours > 0) {
    open.preStartKwh = (open.preStartKwh ?? 0) + (open.lastWatts * options.elapsedHours) / 1000;
  }
}
