// The washing machine's config: cycle detection, the wash's timer, and what
// happens when a wash finishes. It lives beside `power.ts` rather than in it
// because that file is at the size cap (specs/agent-token-footprint.md section
// 3), and `power.ts` re-exports these names so existing imports keep working.
import { z } from "zod";
import { entityIdSchema } from "./primitives";

/**
 * The wash's timer, and what "the machine has stopped" means. The timer runs
 * for its first period from the claim, is extended by `extendMinutes` each time
 * it runs out while the machine is still drawing power to do a wash, and
 * finishes once the meter has read `stopWatts` or less for `stopSeconds` of
 * observed sample time. See specs/power-meters.md, "The wash's timer".
 */
const WashTimerConfigSchema = z.object({
  /** The first period, measured from the claim that starts the timer. */
  firstPeriodMinutes: z.number().positive().max(480).default(70),
  /** Added to the period for each extension. */
  extendMinutes: z.number().positive().max(60).default(10),
  /**
   * At or below this the machine is not drawing power to do a wash — it is off.
   * The same floor as `endWatts` (§4.1): a wash's own soak and drain pauses read
   * 4-5 W, so a threshold above them finishes a wash the machine is still
   * running. This is the threshold the wash's timer and the completion record
   * both read.
   */
  stopWatts: z.number().nonnegative().default(2),
  /** Quiet for strictly longer than this finishes the wash's timer. */
  stopSeconds: z.number().positive().default(120),
  /**
   * A report already older than this cannot anchor the quiet window, and a
   * sample gap this long resets it. The plugs report on change, so a payload
   * sits at its last report time while nothing changes (§7.2).
   */
  maxSampleGapSeconds: z.number().positive().default(90),
});
export type WashTimerConfig = z.infer<typeof WashTimerConfigSchema>;
export { WashTimerConfigSchema };

/**
 * One window of the machine's plan where the unit rate differs from the plan's
 * own — a retailer's free hours, or a half-price night.
 *
 * A window is anchored on the local day it OPENS, so `21:00`-`07:00` belongs to
 * the evening it began: after midnight it is still that evening's window, and
 * its day list is read against yesterday. Hence the two passes in the matcher
 * rather than a 48-hour clock.
 */
const WashRateWindowSchema = z.object({
  label: z.string().min(1),
  /** Local days the window opens on. `21:00`-`07:00` on `mon`-`fri` is five windows. */
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1),
  /** Minutes past local midnight; `1440` is the end of the day. */
  fromMinute: z.number().int().min(0).max(1440),
  /** Minutes past local midnight; below `fromMinute` means the window crosses midnight. */
  toMinute: z.number().int().min(0).max(1440),
  /** The unit rate inside the window, in cents per kWh including GST. */
  cPerKwh: z.number().nonnegative(),
});
export type WashRateWindow = z.infer<typeof WashRateWindowSchema>;

/**
 * The electricity plan the washing machine is costed at, when that is not the
 * plan the rest of the panel uses.
 *
 * The two are genuinely different questions: the grid is one household's total
 * consumption at whatever it buys, while a wash is a single appliance whose cost
 * someone is looking at on its own — at a retailer's rates for this address, on
 * the plan that address is on. Rates are what the bill states, so they include
 * GST and a wash's cost reads the same as its line on the bill.
 */
const WashRatesSchema = z.object({
  planName: z.string().min(1),
  /** Where the numbers were read from, so a later session can re-check them. */
  sourceUrl: z.string().min(1).optional(),
  /** The date the numbers were read, `YYYY-MM-DD`. */
  asOf: z.string().min(1).optional(),
  /** The plan's unit rate outside every window, in cents per kWh including GST. */
  cPerKwh: z.number().nonnegative(),
  windows: z.array(WashRateWindowSchema).default([]),
});
export type WashRates = z.infer<typeof WashRatesSchema>;
export { WashRatesSchema, WashRateWindowSchema };

/**
 * Cycle detection for a washing machine on a metering plug. Every threshold is
 * config so a different machine is a config edit. See specs/power-meters.md §4.
 */
const WashingMachineConfigSchema = z.object({
  powerSensorEntityId: entityIdSchema,
  /**
   * Read when `powerSensorEntityId` is unavailable — a cloud twin behind a
   * local sensor (specs/power-meters.md §7.2).
   */
  fallbackPowerSensorEntityId: entityIdSchema.optional(),
  /**
   * A cumulative kWh counter on the same plug (total_increasing, never a
   * per-interval increment). When set, energy comes from the
   * counter's delta and power only drives detection (§7.3).
   */
  energySensorEntityId: entityIdSchema.optional(),
  entityIds: z.array(entityIdSchema).min(1),
  startWatts: z.number().nonnegative().default(15),
  startSustainedSeconds: z.number().positive().default(120),
  /** The off floor, under what a wash's own pauses draw (§4.1). */
  endWatts: z.number().nonnegative().default(2),
  /**
   * Longer than the wash's own timer's quiet (`timer.stopSeconds`), so the
   * timer always finishes the wash before the block closes (§4.1).
   */
  endQuietSeconds: z.number().positive().default(180),
  minCycleKwh: z.number().nonnegative().default(0.05),
  /**
   * The shortest a real cycle can be: a standalone spin, about eleven minutes on
   * this machine. A closed cycle at least this long is kept whatever it drew, so
   * a short low-power spin is not dropped as a blip by the energy floor alone —
   * a spin is exactly the cycle that floor was never able to judge (§4.1).
   */
  minCycleMinutes: z.number().positive().default(11),
  /**
   * The machine's own electricity plan, when the wash is costed at rates the
   * rest of the panel does not use (§4.1). Absent leaves the wash on the
   * household's plan, which is what a single-plan household wants.
   */
  rates: WashRatesSchema.optional(),
  /** The wash's timer: the claim's countdown and the machine's own stop rule. */
  timer: WashTimerConfigSchema.default({
    extendMinutes: 10,
    firstPeriodMinutes: 70,
    maxSampleGapSeconds: 90,
    stopSeconds: 120,
    stopWatts: 2,
  }),
  /**
   * What a wash's own heat-up says about the cycle temperature somebody chose
   * (§5.3). The element is the only part of a cycle that draws kilowatts, and it
   * runs until the water reaches the thermostat's target — so the plateau's length
   * is the only trace of the button that was pressed, and a wash with no plateau at
   * all is a cold cycle.
   *
   * The numbers are this machine's, measured from its own traces: 487 s of heat-up
   * was a 40° cycle and 899 s was a 60°, which is a 15 °C fill and about 19.5 s of
   * heating per degree of rise.
   */
  temperature: z
    .object({
      /** At or above this the element is on: a 2 kW heater draws about 2.2 kW. */
      heaterWatts: z.number().positive().default(1500),
      /** What the water comes in at, which the rise is measured from. */
      inletDegrees: z.number().nonnegative().default(15),
      /** Seconds of heating for each degree the machine has to raise the water. */
      secondsPerDegree: z.number().positive().default(19.5),
      /** The buttons the machine offers: a measured rise snaps to one of them. */
      options: z.array(z.number().positive()).min(1).default([20, 30, 40, 60, 90]),
      /** Shorter than this is the element topping up, not a cycle's heat-up. */
      minimumSeconds: z.number().positive().default(120),
    })
    .default({
      heaterWatts: 1500,
      inletDegrees: 15,
      minimumSeconds: 120,
      options: [20, 30, 40, 60, 90],
      secondsPerDegree: 19.5,
    }),
  /**
   * The person an unclaimed wash belongs to: nobody claimed it, so it was not
   * the primary person's. Absent leaves such a wash Unassigned, which is what a
   * household with nobody else in it wants. Must name a configured person.
   */
  unclaimedPersonId: z.string().min(1).optional(),
  completionAlert: z.object({
    enabled: z.boolean().default(false),
    personId: z.string().min(1),
    discord: z.boolean().default(false),
    drying: z.object({
      hours: z.number().int().min(1).max(12).default(4),
      daylightHours: z.number().nonnegative().default(3),
      maxRainMm: z.number().nonnegative().default(0.1),
      maxRainChancePct: z.number().min(0).max(100).default(30),
    }).default({ hours: 4, daylightHours: 3, maxRainMm: 0.1, maxRainChancePct: 30 }),
  }).optional(),
});
export type WashingMachineConfig = z.infer<typeof WashingMachineConfigSchema>;
export { WashingMachineConfigSchema };
