import { z } from "zod";

const ThemeColorValueSchema = z.object({
  cursor: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  intensity: z.number().int().min(0).max(100),
  rgb: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]),
});
export const NovaAvatarConfigSchema = z.object({
  gradientAlert: ThemeColorValueSchema,
  gradientCenter: ThemeColorValueSchema,
  gradientOuter: ThemeColorValueSchema,
  gymAlertThresholdHours: z.number().int().min(1).max(168),
  gymNumberColor: ThemeColorValueSchema,
  gymNumberOpacity: z.number().int().min(0).max(100),
  lineColors: z.tuple([ThemeColorValueSchema, ThemeColorValueSchema, ThemeColorValueSchema]),
  lineOpacities: z.tuple([
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
  ]),
  // Per-orb-module slider values (moduleId -> settingId -> value). Optional so
  // existing config files stay valid; without it zod's strip mode would drop
  // the field whenever the legacy config.dashboard.avatar path round-trips.
  orbModuleSettings: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  // Colour of the voice-listening glow behind the orb. Optional for the same
  // round-trip reason as orbModuleSettings above (the authoritative per-variant
  // theme avatar carries it via normalizeNovaAvatarTheme).
  voiceGlowColor: ThemeColorValueSchema.optional(),
});
