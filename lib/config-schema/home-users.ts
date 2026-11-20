import { z } from "zod";

/**
 * Home users (specs/home-users.md): the fields a household person gains so a
 * device can show one person's rooms and Quick Access, and the house can react
 * to who is home. Every field defaults, so a config written before this loads
 * unchanged, and a person with no rooms is not a home user at all.
 */

/** The evening adaptive brightness today; a new person's night maximum. */
export const DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT = 60;

export const HomeUserQuickAccessEntrySchema = z.discriminatedUnion("kind", [
  /** Any control preset that exists (aircon, heater, amplifier, room lighting...). */
  z.object({ kind: z.literal("preset"), presetId: z.string().min(1) }),
  /** A room-lighting control for one room, named by the room's current name. */
  z.object({ kind: z.literal("room-lights"), zoneId: z.string().min(1) }),
  /** Every light this person controls (their `member:<id>` zone). */
  z.object({ kind: z.literal("all-lights") }),
]);
export type HomeUserQuickAccessEntry = z.infer<typeof HomeUserQuickAccessEntrySchema>;

/**
 * Spread into HouseholdPersonSchema, like the arrival fields. Optional rather
 * than defaulted so every existing person literal stays valid; readers apply
 * the defaults (empty, false, DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT).
 */
export const HouseholdPersonHomeUserFields = {
  /** Room zone ids this person sees and controls. */
  rooms: z.array(z.string().min(1)).optional(),
  /** Home (the aggregate zone) and the Systems accordion. */
  showSystemTabs: z.boolean().optional(),
  /** This person's Quick Access card, in order. */
  quickAccess: z.array(HomeUserQuickAccessEntrySchema).optional(),
  /** The brightest adaptive lighting may be at night in this person's rooms. */
  nightMaxBrightnessPct: z.number().int().min(1).max(100).optional(),
};

/** Per-zone facts Home Assistant cannot express, keyed by zone (area) id. */
export const HomeZoneSettingSchema = z.object({
  zoneId: z.string().min(1),
  /** Someone's bedroom: owned by the home users who have it in `rooms`. */
  bedroom: z.boolean().default(false),
  /** Lit for a later arrival after sunset. */
  arrivalLight: z.boolean().default(false),
});
export type HomeZoneSetting = z.infer<typeof HomeZoneSettingSchema>;

export const HomeZoneSettingsSchema = z.array(HomeZoneSettingSchema).default([]);
