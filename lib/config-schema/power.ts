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
  icon: z.enum(["amp", "computers", "entertainment", "kitchen", "laundry", "other"]),
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
 * Switch the floating meter's plug with an Apple TV, while — and only while —
 * the plug is measuring the amp. See specs/amp-appletv-power.md.
 *
 * Absent means the feature does not exist: no loop, no ownership, and the
 * meter guard behaves exactly as specs/power-meters.md §1 describes.
 */
const AmpPowerControlSchema = z.object({
  /** The floating-meter category that arms this. Inert under any other (§4.2). */
  categoryId: z.string().min(1),
  /**
   * The media player Home Assistant's `apple_tv` integration publishes. That
   * integration is pyatv, already paired; Nova reads its entity rather than
   * opening a competing Companion session (§1).
   */
  sourceEntityId: entityIdSchema,
  /**
   * States that mean the Apple TV is asleep. Expressed as off-states, not
   * on-states, so an HA release inventing a new playing-ish state keeps the
   * amp on — the safe direction to be wrong in (§1.1).
   */
  offStates: z.array(z.string().min(1)).min(1).default(["off", "standby"]),
  /** The plug, by every id it has been known by, most current first. */
  switchEntityIds: z.array(entityIdSchema).min(1),
  /** No switching command is ever issued within this of the previous one (§4.6). */
  minIntervalSeconds: z.number().positive().default(30),
  pollIntervalSeconds: z.number().positive().default(5),
  /** Unavailable for this long means force the plug on and stand down (§4.4). */
  staleRestoreSeconds: z.number().positive().default(600),
  /**
   * The Apple TV's audio output (§8, specs/appletv-audio-outputs.md). Absent
   * means the amp follows the Apple TV's power state alone.
   */
  audioOutput: z
    .object({
      entityId: entityIdSchema,
      /** The states that mean the amp is worth powering, and that it is not. */
      onStates: z.array(z.string().min(1)).min(1).default(["on"]),
      offStates: z.array(z.string().min(1)).min(1).default(["off"]),
    })
    .optional(),
});
export type AmpPowerControlConfig = z.infer<typeof AmpPowerControlSchema>;
export { AmpPowerControlSchema };

// The wash's config moved to its own domain file at the size cap; see
// lib/config-schema/washing-machine.ts.
export { WashingMachineConfigSchema, WashTimerConfigSchema } from "./washing-machine";
export type { WashingMachineConfig, WashTimerConfig } from "./washing-machine";

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
