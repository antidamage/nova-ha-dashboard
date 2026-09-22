import { z } from "zod";
import { entityIdSchema, stringListSchema } from "./primitives";

/**
 * `dashboard.controls` — the saved control presets and the dashboard slots they
 * sit in (specs/control-modules.md).
 *
 * Empty means "derive from the rest of the config" (see
 * `lib/control-modules/presets.ts`), which is what keeps an existing install
 * exactly as it was on the day this block was added. The same two-level fallback
 * `dashboard.climate.airconUnits` uses over the legacy single-device blocks, and
 * for the same reason.
 *
 * The binding is deliberately one shared bag of optional fields rather than a
 * union per module: which fields are *meaningful* is the module's business, and
 * a module added later must not need a schema change to be installable. The
 * model reports the fields a preset is missing, in the owner's terms, and the
 * config page shows that rather than refusing the save.
 */

export const ControlPresetBindingSchema = z
  .object({
    entityId: entityIdSchema.optional(),
    matchTokens: stringListSchema.optional(),
    switchEntityIds: stringListSchema.optional(),
    temperatureEntityIds: stringListSchema.optional(),
    humidityEntityIds: stringListSchema.optional(),
    dryTargetHumidityPct: z.number().min(20).max(90).optional(),
  })
  .default({});

export const ControlPresetSchema = z.object({
  /** Stable: it keys this preset's remembered settings and its control state. */
  id: z.string().min(1).max(60),
  moduleId: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  /** `null` = inherit the room of the slot this preset is placed in. */
  roomId: z.string().min(1).max(120).nullable().default(null),
  driverId: z.string().min(1).max(60).nullable().default(null),
  variant: z.string().min(1).max(40).nullable().default(null),
  features: z.record(z.string().max(40), z.boolean()).default({}),
  binding: ControlPresetBindingSchema,
});
export type ControlPresetConfig = z.infer<typeof ControlPresetSchema>;

export const ControlSlotSchema = z.object({
  id: z.string().min(1).max(60),
  surface: z.literal("quick-access").default("quick-access"),
  presetId: z.string().min(1).max(60),
  roomId: z.string().min(1).max(120).nullable().default(null),
  visible: z.boolean().default(true),
});
export type ControlSlotConfig = z.infer<typeof ControlSlotSchema>;

export const ControlsConfigSchema = z
  .object({
    /** Set by the route on the first save; see ControlsConfig in lib/control-modules/types.ts. */
    configured: z.boolean().default(false),
    presets: z.array(ControlPresetSchema).default([]),
    slots: z.array(ControlSlotSchema).default([]),
  })
  .default({ configured: false, presets: [], slots: [] });
