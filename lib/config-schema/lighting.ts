import { z } from "zod";
import {
  DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
  DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT,
} from "../lighting-presets";
import { colorTemperatureKelvinSchema, entityIdSchema, lightBrightnessPctSchema } from "./primitives";

export const LightingIntensityThresholdSchema = z.object({
  name: z.string().min(1).optional(),
  thresholdPct: z.number().int().min(0).max(100),
  entityIds: z.array(entityIdSchema).min(1),
});
const LightColorTemperatureOverrideSchema = z.object({
  candlelight: colorTemperatureKelvinSchema.optional(),
  daylight: colorTemperatureKelvinSchema.optional(),
  sunlight: colorTemperatureKelvinSchema.optional(),
});
export const LightingEntityPresetSchema = z.object({
  entityId: entityIdSchema,
  // Force this entity to always use the preset below, ignoring zone brightness/
  // colour commands. Reapplied on every zone edit and by the scheduled poller.
  pinned: z.boolean().optional(),
  targetBrightnessPct: z.object({
    daytime: lightBrightnessPctSchema.default(DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT),
    evening: lightBrightnessPctSchema.default(DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT),
  }).default({
    daytime: DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
    evening: DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT,
  }),
  colorTemperatureOverrideKelvin: LightColorTemperatureOverrideSchema.optional(),
});
/**
 * One timed light event for a zone: a time of day, the days it may fire on,
 * and the colour and level it sets. Brightness 0 means off.
 * See specs/zone-light-events.md.
 */
const ZoneLightEventTimeSchema = z.union([
  z.object({ kind: z.literal("clock"), hhmm: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({
    kind: z.literal("sun"),
    event: z.enum(["sunrise", "sunset"]),
    offsetMinutes: z.number().int().min(-720).max(720).default(0),
  }),
]);
export const ZoneLightEventSchema = z.object({
  id: z.string().min(1),
  zoneId: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  at: ZoneLightEventTimeSchema,
  // Weekdays it may fire on, 0 = Sunday. Empty means every day.
  days: z.array(z.number().int().min(0).max(6)).default([]),
  value: z.object({
    hue: z.number().int().min(0).max(359),
    saturation: z.number().int().min(0).max(100),
    brightnessPct: z.number().int().min(0).max(100),
  }),
});
export type ZoneLightEvent = z.infer<typeof ZoneLightEventSchema>;
export type ZoneLightEventTime = z.infer<typeof ZoneLightEventTimeSchema>;
const ZoneLightRuleValueSchema = z.object({
  hue: z.number().int().min(0).max(359),
  saturation: z.number().int().min(0).max(100),
  brightnessPct: z.number().int().min(0).max(100),
});
const ZoneLightRuleBase = {
  id: z.string().min(1),
  zoneId: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  // Shown as a button in the zone's default view, with a reminder glyph.
  preset: z.object({
    show: z.boolean().default(false),
    icon: z.union([
      z.object({ kind: z.literal("phosphor"), id: z.string().min(1) }),
      z.object({ kind: z.literal("text"), value: z.string().min(1).max(2) }),
    ]).optional(),
    order: z.number().int().default(0),
  }).optional(),
};
/** Every lighting automation for a zone. See specs/zone-light-events.md, round 2. */
export const ZoneLightRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ZoneLightRuleBase,
    kind: z.literal("event"),
    at: ZoneLightEventTimeSchema,
    days: z.array(z.number().int().min(0).max(6)).default([]),
    value: ZoneLightRuleValueSchema,
  }),
  z.object({ ...ZoneLightRuleBase, kind: z.literal("adaptive") }),
  z.object({
    ...ZoneLightRuleBase,
    kind: z.literal("threshold"),
    thresholdPct: z.number().int().min(0).max(100),
    entityIds: z.array(entityIdSchema).min(1),
  }),
  z.object({ ...ZoneLightRuleBase, kind: z.literal("pinned"), entityIds: z.array(entityIdSchema).min(1) }),
  // On and Off are never stored, so a stored preset has no builtin.
  z.object({ ...ZoneLightRuleBase, kind: z.literal("preset"), value: ZoneLightRuleValueSchema }),
]);
