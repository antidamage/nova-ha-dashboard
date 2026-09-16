// Slider ranges and defaults, storage keys, cookie names and event names.
import type { ControlSoundSettings, KnobSkinMode, ThemeConfigScope, ThemeOverride, ThemeSelection, ThemeVariant } from "./types";

export const THEME_FONT_WEIGHT_MIN = 100;
export const THEME_FONT_WEIGHT_MAX = 900;
export const THEME_FONT_WEIGHT_STEP = 100;
export const THEME_FONT_WEIGHT_DEFAULT = 500;
export const THEME_FONT_SIZE_OFFSET_MIN = -100;
export const THEME_FONT_SIZE_OFFSET_MAX = 100;

export const THEME_STORAGE_KEY = "nova.dashboard.accent.v1";
export const SHARED_THEME_STORAGE_KEY = "nova.dashboard.sharedAccent.v1";
export const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
export const THEME_SCOPE_STORAGE_KEY = "nova.dashboard.configScope.v1";
export const THEME_SCOPE_COOKIE_NAME = "nova.dashboard.configScope.v1";
export const THEME_CHANGE_EVENT = "nova-accent-change";
export const THEME_SCOPE_CHANGE_EVENT = "nova-config-scope-change";
export const SUN_CHANGE_EVENT = "nova-sun-change";
export const NOVA_THEME_SET_CHANGE_EVENT = "nova-theme-set-change";
export const DEFAULT_THEME_SCOPE: ThemeConfigScope = "shared";
export const DEFAULT_THEME_SELECTION: ThemeSelection = "auto";
export const SHARED_THEME_POLL_MS = 30 * 1000;
export const SHARED_THEME_WRITE_DEBOUNCE_MS = 250;
export const SHARED_THEME_WRITE_RETRY_MS = 1000;

export const THEME_SELECTIONS: ThemeSelection[] = ["dark", "light", "auto"];
export const THEME_VARIANTS: ThemeVariant[] = ["dark", "light"];
export const KNOB_SKIN_MODES: KnobSkinMode[] = ["auto", "dark", "light"];
export const RADAR_OPACITY_DEFAULT = 87;
export const RADAR_OPACITY_MAX = 100;
export const RADAR_OPACITY_MIN = 0;
export const MAP_LABEL_SIZE_DEFAULT = 150;
export const MAP_LABEL_SIZE_MAX = 200;
export const MAP_LABEL_SIZE_MIN = 50;
export const MAP_BUILDING_OPACITY_DEFAULT = 66;
export const MAP_BUILDING_OPACITY_MAX = 100;
export const MAP_BUILDING_OPACITY_MIN = 0;
export const TASK_GLOW_INTENSITY_DEFAULT = 100;
export const TASK_GLOW_INTENSITY_MAX = 300;
export const TASK_GLOW_INTENSITY_MIN = 50;
export const LIGHTING_TINT_STRENGTH_DEFAULT = 30;
export const LIGHTING_TINT_STRENGTH_MAX = 100;
export const LIGHTING_TINT_STRENGTH_MIN = 0;
export const FLUID_BACKGROUND_APEX_GLOW_DEFAULT = 55;
export const FLUID_BACKGROUND_APEX_GLOW_MAX = 240;
export const FLUID_BACKGROUND_APEX_GLOW_MIN = 0;
export const FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT = 125;
export const FLUID_BACKGROUND_FALLOFF_POWER_MAX = 320;
export const FLUID_BACKGROUND_FALLOFF_POWER_MIN = 80;
export const FLUID_BACKGROUND_HUE_SPREAD_DEFAULT = 100;
export const FLUID_BACKGROUND_HUE_SPREAD_MAX = 100;
export const FLUID_BACKGROUND_HUE_SPREAD_MIN = 0;
export const FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT = 60;
export const FLUID_BACKGROUND_PEAK_INTENSITY_MAX = 260;
export const FLUID_BACKGROUND_PEAK_INTENSITY_MIN = 40;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT = 120;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_MAX = 220;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_MIN = 40;
export const FLUID_BACKGROUND_TEXTURE_SCALE_DEFAULT = 100;
export const FLUID_BACKGROUND_TEXTURE_SCALE_MAX = 500;
export const FLUID_BACKGROUND_TEXTURE_SCALE_MIN = 25;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT = 45;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX = 100;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN = 0;
export const VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT = 8;
export const VOICE_TRANSCRIPT_GLOW_SIZE_MAX = 32;
export const VOICE_TRANSCRIPT_GLOW_SIZE_MIN = 0;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT = 18;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX = 100;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN = 0;
// Percentage scale of the scanline pitch (100 = 1px line / 3px period).
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT = 100;
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX = 300;
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN = 50;
export const CONTROL_SOUND_VOLUME_DEFAULT = 60;
export const CONTROL_SOUND_VOLUME_MAX = 100;
export const CONTROL_SOUND_VOLUME_MIN = 0;
export const DEFAULT_CONTROL_SOUND: ControlSoundSettings = {
  volume: CONTROL_SOUND_VOLUME_DEFAULT,
};

export const THEME_OVERRIDE_STORAGE_KEY = "nova.dashboard.themeOverride.v1";
export const THEME_OVERRIDE_CHANGE_EVENT = "nova-theme-override-change";
export const THEME_OVERRIDE_CYCLE: ThemeOverride[] = ["unset", "auto", "light", "dark"];

export const HOUSE_PARTY_THEME_OVERRIDE_EVENT = "nova-house-party-theme-override";

// Before the panel slot existed, panels were the background mixed 16% toward
// black. Scaling intensity by 0.84 is the same thing, so a theme stored without
// `panel` keeps its look. See specs/panel-surface.md, "Default".
export const PANEL_SEED_INTENSITY_RATIO = 0.84;
