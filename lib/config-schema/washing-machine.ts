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
   * At or below this the machine is not drawing power to do a wash — the
   * machine's panel alerting is not a wash. This is the threshold the wash's
   * timer and the completion record both read (§4.1).
   */
  stopWatts: z.number().nonnegative().default(5),
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
  endWatts: z.number().nonnegative().default(5),
  endQuietSeconds: z.number().positive().default(300),
  minCycleKwh: z.number().nonnegative().default(0.05),
  /** The wash's timer: the claim's countdown and the machine's own stop rule. */
  timer: WashTimerConfigSchema.default({
    extendMinutes: 10,
    firstPeriodMinutes: 70,
    maxSampleGapSeconds: 90,
    stopSeconds: 120,
    stopWatts: 5,
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
