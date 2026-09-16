import { z } from "zod";
import { entityIdSchema } from "./primitives";

const PowerDeviceRatingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().min(1),
  kind: z.enum(["light", "switch", "climate"]),
  // Every entity id this device has been known by, most current first. The
  // first one present in Home Assistant wins, so an entity rename is absorbed
  // by editing config rather than by changing code and redeploying.
  entityIds: z.array(entityIdSchema).min(1),
  aliases: z.array(z.string().min(1)).optional(),
  ratedWatts: z.number().nonnegative(),
  standbyWatts: z.number().nonnegative().optional(),
  maxWatts: z.number().nonnegative().optional(),
  coolInputWatts: z.number().nonnegative().optional(),
  heatInputWatts: z.number().nonnegative().optional(),
  powerSensorEntityId: entityIdSchema.optional(),
  confidence: z.enum(["measured", "high", "medium", "manual", "assumed"]),
  manufacturer: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  source: z.string().min(1),
  sourceUrl: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});
export type PowerDeviceRating = z.infer<typeof PowerDeviceRatingSchema>;
export { PowerDeviceRatingSchema };

/**
 * A metering plug that must never be left switched off. See
 * specs/power-meters.md §1 — the guard restores `off` immediately and says
 * nothing to anyone about it.
 */
const AlwaysOnMeterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Every switch entity this plug has been known by, most current first. */
  switchEntityIds: z.array(entityIdSchema).min(1),
});
export type AlwaysOnMeter = z.infer<typeof AlwaysOnMeterSchema>;
export { AlwaysOnMeterSchema };

/**
 * One group the floating meter can be moved onto. `seedWatts` is the guess
 * used until the group has been measured for `minLearnedHours`;
 * `suppressesBaseLoads` names the modelled base loads this group replaces, so
 * the grid total does not count the same fridge twice.
 */
const FloatingMeterCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.enum(["computers", "entertainment", "kitchen", "laundry", "other"]),
  seedWatts: z.number().nonnegative(),
  suppressesBaseLoads: z
    .array(z.enum(["fridges", "water_heater", "desktop_pc", "nova_aio"]))
    .default([]),
  /** Human-readable membership, shown in the panel. Never an entity id. */
  members: z.array(z.string().min(1)).default([]),
});
export type FloatingMeterCategory = z.infer<typeof FloatingMeterCategorySchema>;

const FloatingMeterConfigSchema = z.object({
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
  /** Hours of measurement before a group's own profile outranks its seed. */
  minLearnedHours: z.number().positive().default(24),
  categories: z.array(FloatingMeterCategorySchema).min(1),
});
export type FloatingMeterConfig = z.infer<typeof FloatingMeterConfigSchema>;
export { FloatingMeterConfigSchema };

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
  completionAlert: z.object({
    enabled: z.boolean().default(false),
    personId: z.string().min(1),
    soundFile: z.string().regex(/^[a-zA-Z0-9_-]+\.mp3$/),
    zeroWatts: z.number().nonnegative().default(0),
    quietSeconds: z.number().positive().default(60),
    maxSampleGapSeconds: z.number().positive().default(90),
    discord: z.boolean().default(false),
    drying: z.object({
      hours: z.number().int().min(1).max(12).default(4),
      daylightHours: z.number().nonnegative().default(3),
      maxRainMm: z.number().nonnegative().default(0.1),
      maxRainChancePct: z.number().min(0).max(100).default(30),
    }).default({ hours: 4, daylightHours: 3, maxRainMm: 0.1, maxRainChancePct: 30 }),
  }).optional(),
  /** Rule-based guess at one person's washes. See specs/power-meters.md §4.5. */
  typicalMinutes: z.number().positive().max(480).default(66),
  autoAttribution: z.object({
    enabled: z.boolean().default(false),
    personId: z.string().min(1),
    standardMinMinutes: z.number().positive().default(55),
    standardMaxMinutes: z.number().positive().default(95),
    minDaysSinceLast: z.number().positive().default(5),
    consecutiveMaxGapMinutes: z.number().nonnegative().default(60),
    spinMaxMinutes: z.number().positive().default(15),
    spinMaxGapMinutes: z.number().nonnegative().default(30),
  }).optional(),
});
export type WashingMachineConfig = z.infer<typeof WashingMachineConfigSchema>;
export { WashingMachineConfigSchema };

/**
 * A person in this household, for attributing shared consumption. Personal
 * data: ships empty and lives in the household package. With none configured,
 * attribution UI is absent rather than showing placeholder people.
 */
const HouseholdPersonSchema = z.object({
  primary: z.boolean().optional(),
  id: z.string().min(1),
  label: z.string().min(1),
  /** Hex colour used for this person's blocks and totals. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type HouseholdPerson = z.infer<typeof HouseholdPersonSchema>;
export { HouseholdPersonSchema };

const monthlyRateSchema = z.array(z.number().nonnegative()).length(12);

/**
 * One electricity plan's published unit rates, by calendar month.
 *
 * These used to be four arrays in lib/power.ts named after a specific retailer
 * and region, which meant every install inherited one household's tariff.
 */
const PowerTariffSchema = z.object({
  planName: z.string().min(1),
  dailyCents: z.number().nonnegative(),
  anytimeCPerKwh: monthlyRateSchema,
  peakCPerKwh: monthlyRateSchema,
  offPeakCPerKwh: monthlyRateSchema,
  /**
   * Superseded rate series, each applying to years up to and including
   * `throughYear`. Historical graphs need the rate that was actually in force.
   */
  historicalAnytimeCPerKwh: z
    .array(z.object({ throughYear: z.number().int(), cPerKwh: monthlyRateSchema }))
    .default([]),
});
export type PowerTariff = z.infer<typeof PowerTariffSchema>;
export { PowerTariffSchema };

/** One month of billed usage, as read off the retailer's account. */
const PowerAccountUsagePointSchema = z.object({
  label: z.string().min(1),
  kwh: z.number().nonnegative(),
  source: z.string().min(1),
  days: z.number().int().positive().optional(),
  kwhPerDay: z.number().nonnegative().optional(),
  costNzd: z.number().nonnegative().optional(),
  costPerDayNzd: z.number().nonnegative().optional(),
  avgUnitCents: z.number().nonnegative().optional(),
});
export type PowerAccountUsagePoint = z.infer<typeof PowerAccountUsagePointSchema>;
export { PowerAccountUsagePointSchema };
