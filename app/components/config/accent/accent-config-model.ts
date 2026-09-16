// Theme editor slot model: which colour slots exist, their labels, and how a
// slot maps onto a DeviceTheme field.
import type {
  DeviceTheme,
  DeviceThemeSet,
  KnobSkinMode,
  MapThemeColorSlot,
  RadarPaletteMode,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeSelection,
  ThemeTitleTone,
  ThemeVariant,
} from "../../theme/accent/types";

export type ThemeConfigColorSlot = ThemeColorSlot | "background";
export type MapConfigSlot = `map.${MapThemeColorSlot}`;
export type TitleConfigSlot = "title.light" | "title.dark";
export type VoiceTranscriptConfigSlot = "voiceTranscript.background" | "voiceTranscript.text";
export type ThemeConfigSlot = ThemeConfigColorSlot | "border" | "panel" | "headerFade" | "clockColor" | "ledColor" | MapConfigSlot | TitleConfigSlot | VoiceTranscriptConfigSlot;
export type ThemeSlotChoice = { slot: ThemeConfigSlot; label: string; detail: string };

export const THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "accent", label: "Accent", detail: "Linework" },
  { slot: "highlight", label: "Highlight", detail: "Selection" },
  { slot: "background", label: "Background", detail: "Surfaces" },
  { slot: "panel", label: "Panels", detail: "Panel fill" },
  { slot: "border", label: "Borders", detail: "Optional lines" },
  { slot: "headerFade", label: "Orb Shadow", detail: "Shadow on scroll" },
  { slot: "ledColor", label: "LED Lights", detail: "Knob lights" },
];

export const MAP_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "map.base", label: "Map Base", detail: "Ground plane" },
  { slot: "map.water", label: "Water", detail: "Harbour fill" },
  { slot: "map.land", label: "Land Use", detail: "Urban fill" },
  { slot: "map.buildingLow", label: "Low Buildings", detail: "1 storey" },
  { slot: "map.buildingHigh", label: "High Buildings", detail: "5+ storeys" },
  { slot: "map.roads", label: "Roads", detail: "Street network" },
  { slot: "map.labels", label: "Labels", detail: "Street text" },
];

export const RADAR_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "map.radarLow", label: "Radar Low", detail: "Light rain" },
  { slot: "map.radarHigh", label: "Radar High", detail: "Heavy rain" },
];

export const TITLE_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "title.light", label: "Title Light", detail: "Light text tone" },
  { slot: "title.dark", label: "Title Dark", detail: "Dark text tone" },
];

export const CLOCK_THEME_SLOT: ThemeSlotChoice = { slot: "clockColor", label: "Clock Colour", detail: "Clock readout" };

export const VOICE_TRANSCRIPT_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "voiceTranscript.background", label: "Transcript Background", detail: "Panel surface" },
  { slot: "voiceTranscript.text", label: "Transcript Text", detail: "Spoken lines" },
];

const ALL_THEME_SLOTS = [...THEME_SLOTS, ...MAP_THEME_SLOTS, ...RADAR_THEME_SLOTS, ...TITLE_THEME_SLOTS, ...VOICE_TRANSCRIPT_THEME_SLOTS];

export const RADAR_PALETTE_MODES: Array<{ value: RadarPaletteMode; label: string }> = [
  { value: "spectrum", label: "Spectrum" },
  { value: "custom", label: "Custom" },
];

export const TITLE_TONES: Array<{ value: ThemeTitleTone; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const THEME_SELECTION_LABELS: Record<ThemeSelection, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

export const THEME_VARIANT_LABELS: Record<ThemeVariant, string> = {
  dark: "Dark",
  light: "Light",
};

export const KNOB_SKIN_LABELS: Record<KnobSkinMode, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

export function isThemeConfigSlot(value: string | null): value is ThemeConfigSlot {
  return ALL_THEME_SLOTS.some((choice) => choice.slot === value);
}

export function isMapConfigSlot(value: ThemeConfigSlot): value is MapConfigSlot {
  return value.startsWith("map.");
}

export function mapSlotKey(slot: MapConfigSlot): MapThemeColorSlot {
  return slot.slice(4) as MapThemeColorSlot;
}

export function isRadarPaletteSlot(slot: ThemeConfigSlot | null) {
  return slot === "map.radarLow" || slot === "map.radarHigh";
}

export function isTitleConfigSlot(value: ThemeConfigSlot): value is TitleConfigSlot {
  return value === "title.light" || value === "title.dark";
}

export function titleSlotKey(slot: TitleConfigSlot) {
  return slot === "title.light" ? "light" : "dark";
}

export function isVoiceTranscriptConfigSlot(value: ThemeConfigSlot): value is VoiceTranscriptConfigSlot {
  return value === "voiceTranscript.background" || value === "voiceTranscript.text";
}

export function voiceTranscriptSlotKey(slot: VoiceTranscriptConfigSlot) {
  return slot === "voiceTranscript.background" ? "background" : "text";
}

export const TASK_GLOW_PREVIEW_MS = 2600;

export function removeLegacyConfigWidgetParam() {
  if (typeof window === "undefined") {
    return;
  }

  const current = new URL(window.location.href);
  if (!current.searchParams.has("widget")) {
    return;
  }

  current.searchParams.delete("widget");
  const nextSearch = current.searchParams.toString();
  const nextUrl = `${current.pathname}${nextSearch ? `?${nextSearch}` : ""}${current.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function formatBytes(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return "";
  }

  const bytes = Number(value);
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Compares two theme sets for "unsaved changes" detection.
export function themeSetSignature(set: DeviceThemeSet): string {
  return JSON.stringify({
    selection: set.selection,
    themes: { dark: set.themes.dark, light: set.themes.light },
  });
}

export function themeColorForSlot(theme: DeviceTheme, slot: ThemeConfigSlot): ThemeColorValue {
  if (slot === "border") {
    return theme.border.color;
  }
  if (slot === "headerFade") {
    return theme.headerFade.color;
  }
  if (slot === "panel") {
    return theme.panel.color;
  }
  if (slot === "clockColor") {
    return theme.clockColor;
  }
  if (slot === "ledColor") {
    return theme.ledColor;
  }
  if (isTitleConfigSlot(slot)) {
    return theme.titleColors[titleSlotKey(slot)];
  }
  if (isVoiceTranscriptConfigSlot(slot)) {
    return theme.voiceTranscriptColors[voiceTranscriptSlotKey(slot)];
  }
  if (isMapConfigSlot(slot)) {
    return theme.map[mapSlotKey(slot)];
  }
  return theme[slot];
}

/** The editor's setTheme, passed to the section components. */
export type SetConfigTheme = (nextTheme: DeviceTheme, options?: { persist?: boolean }) => void;
