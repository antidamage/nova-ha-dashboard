import { z } from "zod";

/**
 * Arrival and departure states (specs/arrival-and-departure.md).
 *
 * A state is deliberately only a target kind and a preset id. What a preset IS
 * belongs to the target that owns it — a zone lighting rule, an entry in
 * dashboard.arrivals.climatePresets, one in volumePresets — so a fourth kind is
 * a new file under lib/arrivals/targets/ plus one line in its registry and the
 * enum below, and this schema does not learn anything about air conditioning.
 */

/** The kinds of device state an arrival or departure entry may set. */
export const ARRIVAL_TARGET_KINDS = ["lighting", "climate", "volume"] as const;
export type ArrivalTargetKind = (typeof ARRIVAL_TARGET_KINDS)[number];

export const ArrivalStateSchema = z.object({
  target: z.enum(ARRIVAL_TARGET_KINDS),
  /** A preset id the target publishes; see lib/arrivals/targets.ts. */
  presetId: z.string().min(1),
});
export type ArrivalState = z.infer<typeof ArrivalStateSchema>;

/**
 * The two state lists a household person carries, spread into
 * HouseholdPersonSchema so membership, colour and these lists stay one record.
 */
export const HouseholdPersonArrivalFields = {
  /** Applied by GET /api/arrival/<name>, in order. */
  arrival: z.array(ArrivalStateSchema).default([]),
  /** Applied by GET /api/departure/<name>, in order. */
  departure: z.array(ArrivalStateSchema).default([]),
};

/**
 * An air conditioning preset, applied through applyClimateControlIntent
 * (lib/climate-control/types.ts). Nothing else in the dashboard has a named
 * aircon preset to borrow, so these exist to be named by an arrival or a
 * departure and by nothing else.
 */
export const ClimateArrivalPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** A configured climate instance id (lib/climate-instances.ts). */
  instanceId: z.string().min(1),
  mode: z.enum(["auto", "manual", "off"]),
  direction: z.enum(["heat", "cool", "dry", "fan_only"]).optional(),
  temperature: z.number().optional(),
});
export type ClimateArrivalPreset = z.infer<typeof ClimateArrivalPresetSchema>;

/**
 * A volume preset: the dashboard's own sound volume, the same 0-100 the Volume
 * slider under Theme & Experience → Sound sets.
 */
export const VolumeArrivalPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  volumePct: z.number().int().min(0).max(100),
});
export type VolumeArrivalPreset = z.infer<typeof VolumeArrivalPresetSchema>;

/** Presets for targets that own no preset concept of their own. Both ship empty. */
export const ArrivalsConfigSchema = z.object({
  climatePresets: z.array(ClimateArrivalPresetSchema).default([]),
  volumePresets: z.array(VolumeArrivalPresetSchema).default([]),
});
export type ArrivalsConfig = z.infer<typeof ArrivalsConfigSchema>;
