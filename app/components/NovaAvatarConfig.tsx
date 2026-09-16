"use client";

// Status Orb config section — facade (specs/agent-token-footprint.md §3.3).
// The body lives in avatar/avatar-config/:
//
//   types.ts                  slot, slider-key and prop types
//   constants.ts              slot list, glass slider list, preview sizes
//   slot-model.ts             slot readers, alert-rate text
//   OrbModuleSwatch.tsx       rendered module thumbnail
//   OrbModuleSelect.tsx       the orb module dropdown
//   PinnedOrbPreview.tsx      the pinned, shrinking preview orb
//   useAvatarThemeEdits.ts    theme writers for each edit
//   NovaAvatarConfigView.tsx  the section body
//   NovaAvatarConfig.tsx      the exported entry point

export { NovaAvatarConfig } from "./avatar/avatar-config/NovaAvatarConfig";
export { DEFAULT_NOVA_AVATAR_THEME } from "./avatar/theme-model/constants";
