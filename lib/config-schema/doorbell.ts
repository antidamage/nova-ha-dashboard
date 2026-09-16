import { z } from "zod";
import { millisecondsSchema } from "./primitives";

/**
 * Smart doorbell: knock + presence fusion, alerts, and the gated unlock path.
 *
 * This is the PUBLIC half only. Secret-knock rhythm templates are an unlock
 * credential and the shared config is served to every browser on the network,
 * so templates live encrypted in data/doorbell-secrets.json.enc and only their
 * metadata (id, label, whether it is configured) appears here.
 *
 * Every field is defaulted so existing config files keep validating; access is
 * off by default so enabling the unlock path is always a deliberate act.
 */
export const DoorbellScheduleSchema = z.object({
  id: z.string().min(1),
  windows: z
    .array(
      z.object({
        /** 0 = Sunday, matching Date#getDay. */
        daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
        /** "HH:MM" local to access.timezone. end < start crosses midnight. */
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .default([]),
  /** "YYYY-MM-DD" dates on which this schedule never grants access. */
  denyDates: z.array(z.string()).default([]),
});

export const DoorbellSecretMetaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  configured: z.boolean().default(false),
  scheduleIds: z.array(z.string()).default([]),
  maxSuccessfulUses: z.number().int().min(1).nullable().default(null),
  successfulUses: z.number().int().min(0).default(0),
});

export const DoorbellConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    deviceId: z.string().default("front-door"),
    fusion: z
      .object({
        /** The stated requirement is three. Below two is not a doorbell. */
        minimumKnocks: z.number().int().min(2).max(16).default(3),
        presenceLeadMs: millisecondsSchema.default(2_000),
        presenceTrailMs: millisecondsSchema.default(2_000),
        notificationCooldownMs: millisecondsSchema.default(15_000),
      })
      .prefault({}),
    alerts: z
      .object({
        visualTimeoutMs: millisecondsSchema.default(12_000),
        visitorSoundAssetId: z.string().default("doorbell-visitor"),
        authorizedSoundAssetId: z.string().default("doorbell-authorized"),
        failureSoundAssetId: z.string().default("doorbell-failed"),
      })
      .prefault({}),
    access: z
      .object({
        /** Master switch. Off means notification-only, whatever else is set. */
        enabled: z.boolean().default(false),
        mode: z.enum(["notify_only", "unlock"]).default("notify_only"),
        // Doorbell access windows are wall-clock times at the door. Defaults to
        // the host's own zone rather than a city, so an unconfigured install is
        // wrong only by however far its server clock is set wrong.
        timezone: z.string().default(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
        requirePresence: z.boolean().default(true),
        failedAttemptLimit: z.number().int().min(1).max(50).default(5),
        lockoutMs: millisecondsSchema.default(900_000),
        /** Best match must beat the runner-up by this much to count. */
        ambiguityMargin: z.number().min(0).max(1).default(0.2),
        /** The HA lock entity. Null means notification-only regardless. */
        lockEntityId: z.string().nullable().default(null),
      })
      .prefault({}),
    schedules: z.array(DoorbellScheduleSchema).default([]),
    secrets: z.array(DoorbellSecretMetaSchema).default([]),
  })
  .prefault({});
