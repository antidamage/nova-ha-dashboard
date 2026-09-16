"use client";

// Status orb theme model — facade (specs/agent-token-footprint.md §3.3). The
// body lives in avatar/theme-model/:
//
//   types.ts        AvatarThemeColorValue, NovaGlassSettings, NovaAvatarTheme
//   constants.ts    default glass settings, default theme, alert-rate default
//   theme-model.ts  alertPulseScale and the normalizers

export type {
  AvatarThemeColorValue,
  NovaAvatarTheme,
  NovaGlassSettings,
} from "./avatar/theme-model/types";
export {
  ALERT_PULSE_RATE_DEFAULT,
  DEFAULT_NOVA_AVATAR_THEME,
  DEFAULT_NOVA_GLASS_SETTINGS,
} from "./avatar/theme-model/constants";
export {
  alertPulseScale,
  normalizeGymAlertThresholdHours,
  normalizeNovaAvatarTheme,
  normalizeNovaGlassSettings,
} from "./avatar/theme-model/theme-model";
