"use client";

import { ArrowLeftRight, Bell, Check, CircleDot, Clipboard, Copy, Download, Image as ImageIcon, Map as MapIcon, Music, Palette, Play, SlidersHorizontal, Trash2, Type, Upload, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  DeviceTheme,
  DeviceThemeSet,
  DesktopWallpaperSettings,
  FLUID_BACKGROUND_APEX_GLOW_DEFAULT,
  FLUID_BACKGROUND_APEX_GLOW_MAX,
  FLUID_BACKGROUND_APEX_GLOW_MIN,
  FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT,
  FLUID_BACKGROUND_FALLOFF_POWER_MAX,
  FLUID_BACKGROUND_FALLOFF_POWER_MIN,
  FLUID_BACKGROUND_HUE_SPREAD_DEFAULT,
  FLUID_BACKGROUND_HUE_SPREAD_MAX,
  FLUID_BACKGROUND_HUE_SPREAD_MIN,
  FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT,
  FLUID_BACKGROUND_PEAK_INTENSITY_MAX,
  FLUID_BACKGROUND_PEAK_INTENSITY_MIN,
  FLUID_BACKGROUND_TEXTURE_SCALE_MAX,
  FLUID_BACKGROUND_TEXTURE_SCALE_MIN,
  FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MAX,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MIN,
  FluidBackgroundSettings,
  MAP_BUILDING_OPACITY_DEFAULT,
  MAP_BUILDING_OPACITY_MAX,
  MAP_BUILDING_OPACITY_MIN,
  MAP_LABEL_SIZE_DEFAULT,
  MAP_LABEL_SIZE_MAX,
  MAP_LABEL_SIZE_MIN,
  MapThemeColorSlot,
  RADAR_OPACITY_DEFAULT,
  RADAR_OPACITY_MAX,
  RADAR_OPACITY_MIN,
  RadarPaletteMode,
  SunThemeStatus,
  TASK_GLOW_INTENSITY_DEFAULT,
  TASK_GLOW_INTENSITY_MAX,
  TASK_GLOW_INTENSITY_MIN,
  THEME_SELECTIONS,
  THEME_VARIANTS,
  ThemeBorderValue,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeMapLayerValue,
  ThemeSelection,
  ThemeStorageValue,
  ThemeTitleTone,
  ThemeVariant,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN,
  VOICE_TRANSCRIPT_GLOW_SIZE_MAX,
  VOICE_TRANSCRIPT_GLOW_SIZE_MIN,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN,
  appliedThemeRgb,
  setDocumentThemeOverride,
  CONTROL_SOUND_FILE_MAX_BYTES,
  CONTROL_SOUND_VOLUME_DEFAULT,
  CONTROL_SOUND_VOLUME_MAX,
  CONTROL_SOUND_VOLUME_MIN,
  ControlSoundSettings,
  normalizeControlSound,
  normalizeControlSoundSource,
  normalizeRadarOpacity,
  normalizeTaskGlowIntensity,
  useDeviceTheme,
} from "./accentColor";
import { type NovaAvatarTheme } from "./avatarThemeModel";
import {
  CheckboxRow,
  ColorIntensitySlider,
  ColorSpectrum,
  ColorWidget,
  ConfigAccordion,
  SliderControlPanel,
} from "./ConfigControls";
import { useConfigPreviewBackground } from "./ConfigPreviewBackground";
import { FontControl } from "./FontControl";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import {
  loadBackgroundTextureStatus,
  removeBackgroundTexture,
  uploadBackgroundTexture,
  type BackgroundTextureStatus,
} from "./background-texture-client";
import {
  loadDesktopWallpapers,
  removeDesktopWallpaper,
  uploadDesktopWallpaper,
  type DesktopWallpaperAsset,
} from "./desktop-wallpaper-client";
import {
  loadTaskReminderAudioStatus,
  removeTaskReminderAudio,
  TASK_REMINDER_AUDIO_PATH,
  uploadTaskReminderAudio,
  type TaskReminderAudioStatus,
} from "./tasks/task-audio-client";
import { VoiceInputDeviceGroup } from "./VoiceInputDeviceGroup";
import { useAutoFullscreen } from "./dashboard/useAutoFullscreen";
import { useAutoFullscreenSetting } from "./dashboard/autoFullscreenSetting";
import { useExperienceFeatures } from "./dashboard/experienceModeSetting";
import { useStatusOrbInfoSetting } from "./dashboard/statusOrbInfoSetting";
import { NovaAvatarConfig } from "./NovaAvatarConfig";
import { useBuildReload } from "./useBuildReload";
import { ThemeLibraryControl } from "./ThemeLibraryControl";
import { useThemeLibrary } from "./themeLibrary";
import { copyColorToClipboard, copySectionToClipboard, useThemeClipboard } from "./themeClipboard";
import { extractSection, mergeSection, type ThemeSectionKind } from "./themeSections";
import { useAgentName } from "./AgentNameContext";

type ThemeConfigColorSlot = ThemeColorSlot | "background";
type MapConfigSlot = `map.${MapThemeColorSlot}`;
type TitleConfigSlot = "title.light" | "title.dark";
type VoiceTranscriptConfigSlot = "voiceTranscript.background" | "voiceTranscript.text";
type ThemeConfigSlot = ThemeConfigColorSlot | "border" | "clockColor" | MapConfigSlot | TitleConfigSlot | VoiceTranscriptConfigSlot;
type ThemeSlotChoice = { slot: ThemeConfigSlot; label: string; detail: string };

const THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "accent", label: "Accent", detail: "Linework" },
  { slot: "highlight", label: "Highlight", detail: "Selection" },
  { slot: "background", label: "Background", detail: "Surfaces" },
  { slot: "border", label: "Borders", detail: "Optional lines" },
];

const MAP_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "map.base", label: "Map Base", detail: "Ground plane" },
  { slot: "map.water", label: "Water", detail: "Harbour fill" },
  { slot: "map.land", label: "Land Use", detail: "Urban fill" },
  { slot: "map.buildingLow", label: "Low Buildings", detail: "1 storey" },
  { slot: "map.buildingHigh", label: "High Buildings", detail: "5+ storeys" },
  { slot: "map.roads", label: "Roads", detail: "Street network" },
  { slot: "map.labels", label: "Labels", detail: "Street text" },
];

const RADAR_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "map.radarLow", label: "Radar Low", detail: "Light rain" },
  { slot: "map.radarHigh", label: "Radar High", detail: "Heavy rain" },
];

const TITLE_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "title.light", label: "Title Light", detail: "Light text tone" },
  { slot: "title.dark", label: "Title Dark", detail: "Dark text tone" },
];

const CLOCK_THEME_SLOT: ThemeSlotChoice = { slot: "clockColor", label: "Clock Colour", detail: "Clock readout" };

const VOICE_TRANSCRIPT_THEME_SLOTS: ThemeSlotChoice[] = [
  { slot: "voiceTranscript.background", label: "Transcript Background", detail: "Panel surface" },
  { slot: "voiceTranscript.text", label: "Transcript Text", detail: "Spoken lines" },
];

const ALL_THEME_SLOTS = [...THEME_SLOTS, ...MAP_THEME_SLOTS, ...RADAR_THEME_SLOTS, ...TITLE_THEME_SLOTS, ...VOICE_TRANSCRIPT_THEME_SLOTS];

const RADAR_PALETTE_MODES: Array<{ value: RadarPaletteMode; label: string }> = [
  { value: "spectrum", label: "Spectrum" },
  { value: "custom", label: "Custom" },
];

const TITLE_TONES: Array<{ value: ThemeTitleTone; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const THEME_SELECTION_LABELS: Record<ThemeSelection, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

const THEME_VARIANT_LABELS: Record<ThemeVariant, string> = {
  dark: "Dark",
  light: "Light",
};

function isThemeConfigSlot(value: string | null): value is ThemeConfigSlot {
  return ALL_THEME_SLOTS.some((choice) => choice.slot === value);
}

function isMapConfigSlot(value: ThemeConfigSlot): value is MapConfigSlot {
  return value.startsWith("map.");
}

function mapSlotKey(slot: MapConfigSlot): MapThemeColorSlot {
  return slot.slice(4) as MapThemeColorSlot;
}

function isRadarPaletteSlot(slot: ThemeConfigSlot | null) {
  return slot === "map.radarLow" || slot === "map.radarHigh";
}

function isTitleConfigSlot(value: ThemeConfigSlot): value is TitleConfigSlot {
  return value === "title.light" || value === "title.dark";
}

function titleSlotKey(slot: TitleConfigSlot) {
  return slot === "title.light" ? "light" : "dark";
}

function isVoiceTranscriptConfigSlot(value: ThemeConfigSlot): value is VoiceTranscriptConfigSlot {
  return value === "voiceTranscript.background" || value === "voiceTranscript.text";
}

function voiceTranscriptSlotKey(slot: VoiceTranscriptConfigSlot) {
  return slot === "voiceTranscript.background" ? "background" : "text";
}

const CONFIG_WIDGET_STORAGE_KEY = "nova.dashboard.configWidget.v1";
const TASK_GLOW_PREVIEW_MS = 2600;
function selectedConfigWidgetFromStorage(): ThemeConfigSlot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const widget = window.sessionStorage.getItem(CONFIG_WIDGET_STORAGE_KEY);
    if (widget === "map.buildings") {
      return "map.buildingLow";
    }
    if (widget === "map.majorRoads" || widget === "map.minorRoads") {
      return "map.roads";
    }
    return isThemeConfigSlot(widget) ? widget : null;
  } catch {
    return null;
  }
}

function writeSelectedConfigWidgetToStorage(widget: ThemeConfigSlot | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (widget) {
      window.sessionStorage.setItem(CONFIG_WIDGET_STORAGE_KEY, widget);
    } else {
      window.sessionStorage.removeItem(CONFIG_WIDGET_STORAGE_KEY);
    }
  } catch {
    // Browsers can deny storage in private or restricted contexts; selection can still live in React state.
  }
}

function removeLegacyConfigWidgetParam() {
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function BorderOpacity({
  border,
  color,
  onCommit,
  onPreview,
}: {
  border: ThemeBorderValue;
  color: [number, number, number];
  onCommit: (border: ThemeBorderValue) => void;
  onPreview: (border: ThemeBorderValue) => void;
}) {
  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="Border opacity"
      ariaValueText={`${border.opacity}%`}
      color={color}
      dotOpacity={border.opacity / 100}
      label="Opacity"
      max={100}
      min={0}
      step={1}
      value={border.opacity}
      valueText={`${border.opacity}%`}
      onPreview={(opacity) => onPreview({ ...border, opacity })}
      onCommit={(opacity) => onCommit({ ...border, opacity })}
    />
  );
}

function BorderToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxRow
      checked={checked}
      label="Custom Borders"
      detail={checked ? "Colour and opacity override active" : "Using current line behaviour"}
      onChange={onChange}
    />
  );
}

function ThemeSelectionControl({
  accentColor,
  highlightColor,
  onCommit,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onCommit: (value: ThemeSelection) => void;
  onPreview: (value: ThemeSelection) => void;
  value: ThemeSelection;
}) {
  const activeIndex = Math.max(0, THEME_SELECTIONS.findIndex((selection) => selection === value));
  const activeLabel = THEME_SELECTION_LABELS[value] ?? "Dark";

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel="Theme selection"
      ariaValueText={activeLabel}
      color={accentColor}
      label="Theme selection"
      max={THEME_SELECTIONS.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(THEME_SELECTIONS[Math.round(index)] ?? "dark")}
      onCommit={(index) => onCommit(THEME_SELECTIONS[Math.round(index)] ?? "dark")}
      markers={THEME_SELECTIONS.map((selection, index) => ({
        active: selection === value,
        label: THEME_SELECTION_LABELS[selection],
        value: index,
      }))}
    />
  );
}

function ThemeVariantTabs({
  onChange,
  value,
}: {
  onChange: (value: ThemeVariant) => void;
  value: ThemeVariant;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Theme editor">
      {THEME_VARIANTS.map((variant) => {
        const active = value === variant;

        return (
          <MomentaryFeedbackButton
            key={variant}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? "true" : "false"}
            className={`theme-choice-tab border p-4 text-left ${active ? "theme-choice-tab-active" : ""}`}
            onClick={() => onChange(variant)}
          >
            <span className="grid min-w-0 gap-1">
              <span className="theme-display-label zone-title-bar">{THEME_VARIANT_LABELS[variant]}</span>
              <span className="theme-display-detail">Edit theme values</span>
            </span>
          </MomentaryFeedbackButton>
        );
      })}
    </div>
  );
}

function WaterToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxRow
      checked={checked}
      label="Water Fill"
      detail={checked ? "Harbour fill is visible on the map" : "Water layer is hidden on the map"}
      onChange={onChange}
    />
  );
}

function WaterOpacity({
  color,
  onCommit,
  onPreview,
  water,
}: {
  color: [number, number, number];
  onCommit: (water: ThemeMapLayerValue) => void;
  onPreview: (water: ThemeMapLayerValue) => void;
  water: ThemeMapLayerValue;
}) {
  const opacity = clamp(Math.round(Number(water.opacity)), 0, 100);

  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="Water opacity"
      ariaValueText={`${opacity}%`}
      color={color}
      dotOpacity={opacity / 100}
      label="Water Opacity"
      max={100}
      min={0}
      step={1}
      value={opacity}
      valueText={`${opacity}%`}
      onPreview={(nextOpacity) => onPreview({ ...water, opacity: nextOpacity })}
      onCommit={(nextOpacity) => onCommit({ ...water, opacity: nextOpacity })}
    />
  );
}

function MapLabelSizeControl({
  color,
  onCommit,
  onPreview,
  value,
}: {
  color: [number, number, number];
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  value: number;
}) {
  const labelSize = clamp(Math.round(Number(value)), MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX);

  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="Map label size"
      ariaValueText={`${labelSize}%`}
      color={color}
      label="Label Size"
      max={MAP_LABEL_SIZE_MAX}
      min={MAP_LABEL_SIZE_MIN}
      step={50}
      value={labelSize}
      valueText={`${labelSize}%`}
      onPreview={onPreview}
      onCommit={onCommit}
      markers={[
        { active: labelSize === MAP_LABEL_SIZE_MIN, label: "Min", value: MAP_LABEL_SIZE_MIN },
        { active: labelSize === MAP_LABEL_SIZE_DEFAULT, label: "Default", value: MAP_LABEL_SIZE_DEFAULT },
        { active: labelSize === MAP_LABEL_SIZE_MAX, label: "Max", value: MAP_LABEL_SIZE_MAX },
      ]}
    />
  );
}

function BuildingOpacityControl({
  highColor,
  lowColor,
  onCommit,
  onPreview,
  value,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  value: number;
}) {
  const opacity = clamp(Math.round(Number(value)), MAP_BUILDING_OPACITY_MIN, MAP_BUILDING_OPACITY_MAX);

  return (
    <SliderControlPanel
      activeColor={highColor}
      ariaLabel="Building opacity"
      ariaValueText={`${opacity}%`}
      color={lowColor}
      dotOpacity={opacity / 100}
      label="Building Opacity"
      max={MAP_BUILDING_OPACITY_MAX}
      min={MAP_BUILDING_OPACITY_MIN}
      step={1}
      value={opacity}
      valueText={`${opacity}%`}
      onPreview={onPreview}
      onCommit={onCommit}
      markers={[
        { active: opacity === MAP_BUILDING_OPACITY_DEFAULT, label: "Default", value: MAP_BUILDING_OPACITY_DEFAULT },
        { active: opacity === MAP_BUILDING_OPACITY_MAX, label: "Max", value: MAP_BUILDING_OPACITY_MAX },
      ]}
    />
  );
}

function TitleToneControl({
  accentColor,
  highlightColor,
  value,
  onCommit,
  onPreview,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  value: ThemeTitleTone;
  onCommit: (value: ThemeTitleTone) => void;
  onPreview: (value: ThemeTitleTone) => void;
}) {
  const activeIndex = Math.max(0, TITLE_TONES.findIndex((tone) => tone.value === value));
  const activeLabel = TITLE_TONES[activeIndex]?.label ?? "Auto";

  return (
    <SliderControlPanel
      activeColor={highlightColor}
      ariaLabel="Text tone"
      ariaValueText={activeLabel}
      color={accentColor}
      label="Text Tone"
      max={TITLE_TONES.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(TITLE_TONES[Math.round(index)]?.value ?? "auto")}
      onCommit={(index) => onCommit(TITLE_TONES[Math.round(index)]?.value ?? "auto")}
      markers={TITLE_TONES.map((tone, index) => ({
        active: tone.value === value,
        label: tone.label,
        value: index,
      }))}
    />
  );
}

function RadarPaletteModeControl({
  highColor,
  lowColor,
  value,
  onCommit,
  onPreview,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  value: RadarPaletteMode;
  onCommit: (value: RadarPaletteMode) => void;
  onPreview: (value: RadarPaletteMode) => void;
}) {
  const activeIndex = Math.max(0, RADAR_PALETTE_MODES.findIndex((mode) => mode.value === value));
  const activeLabel = RADAR_PALETTE_MODES[activeIndex]?.label ?? "Spectrum";

  return (
    <SliderControlPanel
      activeColor={highColor}
      ariaLabel="Radar palette mode"
      ariaValueText={activeLabel}
      color={lowColor}
      label="Radar Palette"
      max={RADAR_PALETTE_MODES.length - 1}
      min={0}
      step={1}
      value={activeIndex}
      valueText={activeLabel}
      onPreview={(index) => onPreview(RADAR_PALETTE_MODES[Math.round(index)]?.value ?? "spectrum")}
      onCommit={(index) => onCommit(RADAR_PALETTE_MODES[Math.round(index)]?.value ?? "spectrum")}
      markers={RADAR_PALETTE_MODES.map((mode, index) => ({
        active: mode.value === value,
        label: mode.label,
        value: index,
      }))}
    />
  );
}

// FontSelect + the reusable FontControl now live in ./FontControl so the gym readout
// and other panels can share them (and the font list's alphabetical-with-current-first
// sorting lives in one place).

function RadarOpacityControl({
  highColor,
  lowColor,
  value,
  onCommit,
  onPreview,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  value: number;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
}) {
  const opacity = normalizeRadarOpacity(value);

  return (
    <SliderControlPanel
      activeColor={highColor}
      ariaLabel="Radar overlay opacity"
      ariaValueText={`${opacity}%`}
      color={lowColor}
      label="Radar Opacity"
      max={RADAR_OPACITY_MAX}
      min={RADAR_OPACITY_MIN}
      step={1}
      value={opacity}
      valueText={`${opacity}%`}
      onPreview={(nextValue) => onPreview(nextValue)}
      onCommit={(nextValue) => onCommit(nextValue)}
    />
  );
}

function TaskGlowIntensityControl({
  color,
  onCommit,
  onPreview,
  onReleased,
  value,
}: {
  color: [number, number, number];
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  onReleased: () => void;
  value: number;
}) {
  const intensity = normalizeTaskGlowIntensity(value);

  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="Reminder glow intensity"
      ariaValueText={`${intensity}%`}
      color={color}
      intensity={Math.min(100, intensity)}
      label="Reminder Glow"
      max={TASK_GLOW_INTENSITY_MAX}
      min={TASK_GLOW_INTENSITY_MIN}
      step={10}
      value={intensity}
      valueText={`${intensity}%`}
      onPreview={(nextValue) => onPreview(normalizeTaskGlowIntensity(nextValue))}
      onCommit={(nextValue) => {
        onCommit(normalizeTaskGlowIntensity(nextValue));
        onReleased();
      }}
      markers={[
        { active: intensity === TASK_GLOW_INTENSITY_DEFAULT, label: "Default", value: TASK_GLOW_INTENSITY_DEFAULT },
        { active: intensity === TASK_GLOW_INTENSITY_MAX, label: "Max", value: TASK_GLOW_INTENSITY_MAX },
      ]}
    />
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function ControlSoundConfig({
  color,
  onChange,
  onPreview,
  value,
}: {
  color: [number, number, number];
  onChange: (value: ControlSoundSettings) => void;
  onPreview: (value: ControlSoundSettings) => void;
  value: ControlSoundSettings;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const settings = normalizeControlSound(value);
  const hasSound = Boolean(settings.source);

  const uploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (file.size > CONTROL_SOUND_FILE_MAX_BYTES) {
      setMessage(`File is too large (max ${Math.round(CONTROL_SOUND_FILE_MAX_BYTES / 1000)} KB)`);
      return;
    }

    setMessage(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!normalizeControlSoundSource(dataUrl)) {
        setMessage("That file isn't a supported audio format");
        return;
      }
      onChange({ ...settings, name: file.name, source: dataUrl });
      setMessage("Sound uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read file");
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const clearSound = () => {
    setMessage(null);
    onChange({ ...settings, name: null, source: null });
  };

  return (
    <div className="grid gap-3">
      <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
        <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm font-black uppercase text-cyan-200">Control Sound</p>
          <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <Music className="h-4 w-4" />
              {hasSound ? (settings.name ?? "Sound ready") : "No sound uploaded"}
            </span>
            {message ? <span className="text-xs text-cyan-100">{message}</span> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
              onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
            {hasSound ? (
              <MomentaryFeedbackButton
                type="button"
                className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
                aria-label="Test control sound"
              >
                <Play className="h-4 w-4" />
                Test
              </MomentaryFeedbackButton>
            ) : null}
            {hasSound ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                type="button"
                onClick={clearSound}
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <SliderControlPanel
        activeColor={color}
        ariaLabel="Control sound volume"
        ariaValueText={`${settings.volume}%`}
        color={color}
        intensity={settings.volume}
        label="Volume"
        max={CONTROL_SOUND_VOLUME_MAX}
        min={CONTROL_SOUND_VOLUME_MIN}
        step={5}
        value={settings.volume}
        valueText={`${settings.volume}%`}
        onPreview={(volume) => onPreview({ ...settings, volume: Math.round(volume) })}
        onCommit={(volume) => {
          onChange({ ...settings, volume: Math.round(volume) });
        }}
        markers={[
          { active: settings.volume === CONTROL_SOUND_VOLUME_DEFAULT, label: "Default", value: CONTROL_SOUND_VOLUME_DEFAULT },
        ]}
      />
    </div>
  );
}

type BackgroundEffectKey = Exclude<keyof FluidBackgroundSettings, "textureScale" | "textureUrl">;

const BACKGROUND_EFFECT_CONTROLS: Array<{
  defaultValue: number;
  key: BackgroundEffectKey;
  label: string;
  max: number;
  min: number;
  step: number;
  valueText: (value: number) => string;
}> = [
  {
    defaultValue: FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT,
    key: "peakIntensity",
    label: "Peak Intensity",
    max: FLUID_BACKGROUND_PEAK_INTENSITY_MAX,
    min: FLUID_BACKGROUND_PEAK_INTENSITY_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_APEX_GLOW_DEFAULT,
    key: "apexGlow",
    label: "Apex Glow",
    max: FLUID_BACKGROUND_APEX_GLOW_MAX,
    min: FLUID_BACKGROUND_APEX_GLOW_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT,
    key: "warpAmplitude",
    label: "Warp Amplitude",
    max: FLUID_BACKGROUND_WARP_AMPLITUDE_MAX,
    min: FLUID_BACKGROUND_WARP_AMPLITUDE_MIN,
    step: 5,
    valueText: (value) => `${value}%`,
  },
  {
    defaultValue: FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT,
    key: "falloffPower",
    label: "Falloff Power",
    max: FLUID_BACKGROUND_FALLOFF_POWER_MAX,
    min: FLUID_BACKGROUND_FALLOFF_POWER_MIN,
    step: 5,
    valueText: (value) => (value / 100).toFixed(2),
  },
  {
    defaultValue: FLUID_BACKGROUND_HUE_SPREAD_DEFAULT,
    key: "hueSpread",
    label: "Hue Drift",
    max: FLUID_BACKGROUND_HUE_SPREAD_MAX,
    min: FLUID_BACKGROUND_HUE_SPREAD_MIN,
    step: 1,
    valueText: (value) => `${value}%`,
  },
];

function BackgroundTextureControl({
  accentColor,
  highlightColor,
  onChange,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onChange: (value: FluidBackgroundSettings) => void;
  onPreview: (value: FluidBackgroundSettings) => void;
  value: FluidBackgroundSettings;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<BackgroundTextureStatus | null>(null);
  const valueRef = useRef(value);
  const active = Boolean(value.textureUrl);
  valueRef.current = value;

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await loadBackgroundTextureStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read background texture");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const uploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await uploadBackgroundTexture(file);
      setStatus(nextStatus);
      onChange({ ...valueRef.current, textureUrl: nextStatus.url ?? "/api/background-texture" });
      setMessage("Texture uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload background texture");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const removeFile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await removeBackgroundTexture();
      setStatus(nextStatus);
      onChange({ ...valueRef.current, textureUrl: null });
      setMessage("Texture removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove background texture");
    } finally {
      setBusy(false);
    }
  };

  const dimensions = status?.width && status?.height ? `${status.width}x${status.height}` : null;

  return (
    <div className="grid gap-3">
      <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
        <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm font-black uppercase text-cyan-200">Texture Map</p>
          <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {active ? "Texture active" : "No texture"}
            </span>
            {status?.exists ? (
              <span className="text-xs text-neutral-500">
                {[dimensions, formatBytes(status.size)].filter(Boolean).join(" / ")}
                {status.updatedAt ? ` / ${new Date(status.updatedAt).toLocaleString()}` : ""}
              </span>
            ) : active ? (
              <span className="text-xs text-red-200">Texture file unavailable</span>
            ) : null}
            {message ? <span className="text-xs text-cyan-100">{message}</span> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {value.textureUrl ? (
              <img
                alt=""
                className="h-11 w-11 border border-cyan-300/40 object-cover"
                src={value.textureUrl}
              />
            ) : null}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Working" : "Upload"}
            </button>
            {active ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                type="button"
                onClick={() => void removeFile()}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <SliderControlPanel
        activeColor={highlightColor}
        ariaLabel="Background texture scale"
        ariaValueText={`${(value.textureScale / 100).toFixed(2)}x`}
        color={accentColor}
        intensity={Math.min(100, Math.max(40, value.textureScale))}
        label="Texture Scale"
        max={FLUID_BACKGROUND_TEXTURE_SCALE_MAX}
        min={FLUID_BACKGROUND_TEXTURE_SCALE_MIN}
        step={0.01}
        value={value.textureScale}
        valueText={`${(value.textureScale / 100).toFixed(2)}x`}
        onPreview={(textureScale) => onPreview({ ...valueRef.current, textureScale })}
        onCommit={(textureScale) => onChange({ ...valueRef.current, textureScale })}
      />
    </div>
  );
}

function DesktopWallpaperControl({
  onChange,
  value,
}: {
  onChange: (value: DesktopWallpaperSettings) => void;
  value: DesktopWallpaperSettings;
}) {
  const landscapeInputRef = useRef<HTMLInputElement | null>(null);
  const portraitInputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<DesktopWallpaperAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const loadAssets = useCallback(async () => {
    try {
      setAssets(await loadDesktopWallpapers());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read desktop wallpapers");
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const uploadFile = async (slot: keyof DesktopWallpaperSettings, file: File | null) => {
    if (!file) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const asset = await uploadDesktopWallpaper(file);
      setAssets((current) => [...current.filter((item) => item.id !== asset.id), asset]);
      onChange({ ...valueRef.current, [slot]: asset.id });
      setMessage("Desktop wallpaper uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload desktop wallpaper");
    } finally {
      setBusy(false);
      if (slot === "landscapeAssetId" && landscapeInputRef.current) {
        landscapeInputRef.current.value = "";
      }
      if (slot === "portraitAssetId" && portraitInputRef.current) {
        portraitInputRef.current.value = "";
      }
    }
  };

  const removeFile = async (slot: keyof DesktopWallpaperSettings) => {
    const assetId = valueRef.current[slot];
    if (!assetId) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const nextAssets = await removeDesktopWallpaper(assetId);
      setAssets(nextAssets);
      onChange({ ...valueRef.current, [slot]: null });
      setMessage("Desktop wallpaper removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove desktop wallpaper");
    } finally {
      setBusy(false);
    }
  };

  const row = (
    slot: keyof DesktopWallpaperSettings,
    label: string,
    detail: string,
    inputRef: RefObject<HTMLInputElement | null>,
  ) => {
    const assetId = value[slot];
    const fallbackAsset = slot === "portraitAssetId" && !assetId ? assetById.get(value.landscapeAssetId ?? "") : null;
    const asset = assetById.get(assetId ?? "") ?? fallbackAsset ?? null;
    const dimensions = asset?.width && asset.height ? `${asset.width}x${asset.height}` : null;

    return (
      <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
        <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
          <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {asset ? asset.name : detail}
            </span>
            {asset ? (
              <span className="text-xs text-neutral-500">
                {[dimensions, formatBytes(asset.size), fallbackAsset ? "landscape fallback" : null].filter(Boolean).join(" / ")}
              </span>
            ) : assetId ? (
              <span className="text-xs text-red-200">Wallpaper file unavailable</span>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {asset ? (
              <img
                alt=""
                className="h-11 w-11 border border-cyan-300/40 object-cover"
                src={asset.url}
              />
            ) : null}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(event) => void uploadFile(slot, event.target.files?.[0] ?? null)}
            />
            {asset ? (
              <a
                className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
                href={asset.url}
                download={asset.name}
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            ) : null}
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Working" : "Upload"}
            </button>
            {assetId ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                type="button"
                onClick={() => void removeFile(slot)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-3">
      {row("landscapeAssetId", "Desktop", "No landscape wallpaper", landscapeInputRef)}
      {row("portraitAssetId", "Portrait", "No portrait wallpaper", portraitInputRef)}
      {message ? <p className="text-xs font-semibold text-cyan-100">{message}</p> : null}
    </div>
  );
}

function BackgroundEffectControls({
  accentColor,
  highlightColor,
  onChange,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onChange: (value: FluidBackgroundSettings) => void;
  onPreview: (value: FluidBackgroundSettings) => void;
  value: FluidBackgroundSettings;
}) {
  return (
    <div className="grid gap-3">
      <BackgroundTextureControl
        accentColor={accentColor}
        highlightColor={highlightColor}
        value={value}
        onChange={onChange}
        onPreview={onPreview}
      />
      {BACKGROUND_EFFECT_CONTROLS.map((control) => {
        const currentValue = value[control.key];
        const displayValue = control.valueText(currentValue);

        return (
          <SliderControlPanel
            key={control.key}
            activeColor={highlightColor}
            ariaLabel={`Apple TV background ${control.label.toLowerCase()}`}
            ariaValueText={displayValue}
            color={accentColor}
            intensity={Math.min(100, Math.max(40, currentValue))}
            label={control.label}
            max={control.max}
            min={control.min}
            step={control.step}
            value={currentValue}
            valueText={displayValue}
            onPreview={(nextValue) => onPreview({ ...value, [control.key]: nextValue })}
            onCommit={(nextValue) => onChange({ ...value, [control.key]: nextValue })}
            markers={[
              { active: currentValue === control.defaultValue, label: "Default", value: control.defaultValue },
              { active: currentValue === control.max, label: "Max", value: control.max },
            ]}
          />
        );
      })}
    </div>
  );
}

function formatBytes(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return "";
  }

  const bytes = Number(value);
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TaskReminderAudioControl({ onStatusChange }: { onStatusChange?: (exists: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskReminderAudioStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await loadTaskReminderAudioStatus();
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read reminder audio");
    }
  }, [onStatusChange]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const uploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await uploadTaskReminderAudio(file);
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
      setMessage("Reminder audio uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload reminder audio");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const removeFile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await removeTaskReminderAudio();
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
      setMessage("Reminder audio removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove reminder audio");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Reminder MP3</p>
        <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
          <span className="inline-flex items-center gap-2">
            <Music className="h-4 w-4" />
            {status?.exists ? "Audio ready" : "No MP3 uploaded"}
          </span>
          {status?.exists ? (
            <span className="text-xs text-neutral-500">
              {formatBytes(status.size)}
              {status.updatedAt ? ` / ${new Date(status.updatedAt).toLocaleString()}` : ""}
            </span>
          ) : null}
          {message ? <span className="text-xs text-cyan-100">{message}</span> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)}
          />
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="h-4 w-4" />
            {busy ? "Working" : "Upload"}
          </button>
          {status?.exists ? (
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => void removeFile()}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Compares two theme sets for "unsaved changes" detection.
function themeSetSignature(set: DeviceThemeSet): string {
  return JSON.stringify({
    selection: set.selection,
    themes: { dark: set.themes.dark, light: set.themes.light },
  });
}

function themeColorForSlot(theme: DeviceTheme, slot: ThemeConfigSlot): ThemeColorValue {
  if (slot === "border") {
    return theme.border.color;
  }
  if (slot === "clockColor") {
    return theme.clockColor;
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

export function AccentConfig({
  initialSun,
  initialTheme,
}: {
  initialSun?: SunThemeStatus | null;
  initialTheme?: ThemeStorageValue | null;
}) {
  const { agentName } = useAgentName();
  useBuildReload();

  // Defer revealing the theme panels until after hydration. Their visibility is
  // gated on themeReady, which is derived from client-only storage and so can
  // differ from the server render. Gating on a post-mount flag keeps the first
  // client render identical to the server (both hidden), avoiding a hydration
  // mismatch that React refuses to patch — which previously left the panels
  // stuck hidden whenever themeReady started true and never changed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    activeVariant,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
    themeReady,
    themeScope,
    themeSet,
  } = useDeviceTheme(initialTheme, initialSun);
  const [followVisualizerWhenActive, setFollowVisualizerWhenActive] = useState(false);
  const [followVisualizerError, setFollowVisualizerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/theme", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Shared config request failed: ${response.status}`);
        const payload = await response.json() as { followVisualizerWhenActive?: boolean };
        if (!cancelled) setFollowVisualizerWhenActive(payload.followVisualizerWhenActive === true);
      })
      .catch((error) => {
        if (!cancelled) {
          setFollowVisualizerError(error instanceof Error ? error.message : "Failed to load shared config");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateFollowVisualizerWhenActive = useCallback(async (checked: boolean) => {
    const previous = followVisualizerWhenActive;
    setFollowVisualizerWhenActive(checked);
    setFollowVisualizerError(null);
    try {
      const response = await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followVisualizerWhenActive: checked }),
      });
      if (!response.ok) throw new Error(`Shared config update failed: ${response.status}`);
      const payload = await response.json() as { followVisualizerWhenActive?: boolean };
      setFollowVisualizerWhenActive(payload.followVisualizerWhenActive === true);
    } catch (error) {
      setFollowVisualizerWhenActive(previous);
      setFollowVisualizerError(error instanceof Error ? error.message : "Failed to save shared config");
    }
  }, [followVisualizerWhenActive]);

  // The shared/local scope switch has been retired: the editor always targets
  // the shared host theme so loaded themes and edits reach every dashboard.
  useEffect(() => {
    if (themeScope !== "shared") {
      setThemeScope("shared");
    }
  }, [themeScope, setThemeScope]);

  const library = useThemeLibrary();
  const clipboard = useThemeClipboard();
  const [editingVariant, setEditingVariant] = useState<ThemeVariant>(activeVariant);
  const theme = themeSet.themes[editingVariant];
  const previewBackground = useConfigPreviewBackground();
  const setPreviewTheme = previewBackground?.setPreviewTheme;

  // Render the whole config page in the variant currently being edited: both the
  // live fluid background and the page chrome (CSS colour variables) follow the
  // editing tab, so editing the light theme shows the editor in light even when
  // the active selection resolves to dark. setDocumentThemeOverride pins :root to
  // this variant so the shared-theme poll and sun-change events in useDeviceTheme
  // apply it (instead of the selection-resolved variant) too — without that pin the
  // page flickered between the edited variant and the dashboard's active one.
  useEffect(() => {
    setPreviewTheme?.(theme);
    setDocumentThemeOverride(theme);
  }, [setPreviewTheme, theme]);
  // On unmount, clear the preview canvas and release the override so the document
  // returns to the active (selection-resolved) theme. Only on unmount so editing
  // never remounts the canvas.
  useEffect(() => {
    return () => {
      setPreviewTheme?.(null);
      setDocumentThemeOverride(null);
    };
  }, [setPreviewTheme]);
  const [autoFullscreen, setAutoFullscreen] = useAutoFullscreenSetting();
  useAutoFullscreen(autoFullscreen);
  const [experienceFeatures, setExperienceFeature] = useExperienceFeatures();
  const [statusOrbInfoVisible, setStatusOrbInfoVisible] = useStatusOrbInfoSetting();
  const [activeSlot, setActiveSlot] = useState<ThemeConfigSlot | null>(selectedConfigWidgetFromStorage);
  const [taskReminderAudioExists, setTaskReminderAudioExists] = useState(false);
  const taskAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const taskAudioPreviewStopTimer = useRef<number | null>(null);
  const taskGlowPreviewTimer = useRef<number | null>(null);
  const accentRgb = appliedThemeRgb(theme.accent);
  const highlightRgb = appliedThemeRgb(theme.highlight);
  const borderRgb = appliedThemeRgb(theme.border.color);
  const buildingLowRgb = appliedThemeRgb(theme.map.buildingLow);
  const buildingHighRgb = appliedThemeRgb(theme.map.buildingHigh);
  const labelRgb = appliedThemeRgb(theme.map.labels);
  const waterRgb = appliedThemeRgb(theme.map.water);
  const radarLowRgb = appliedThemeRgb(theme.map.radarLow);
  const radarHighRgb = appliedThemeRgb(theme.map.radarHigh);

  const setTheme = useCallback((nextTheme: DeviceTheme, options: { persist?: boolean } = {}) => {
    setThemeVariant(editingVariant, nextTheme, options);
  }, [editingVariant, setThemeVariant]);

  const setThemeColor = useCallback((slot: ThemeConfigColorSlot, value: ThemeColorValue, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, [slot]: value }, options);
  }, [setTheme, theme]);

  const updateSlotColor = (slot: ThemeConfigSlot, value: ThemeColorValue, options: { persist?: boolean } = {}) => {
    if (slot === "border") {
      setTheme({ ...theme, border: { ...theme.border, color: value } }, options);
      return;
    }
    if (slot === "clockColor") {
      setTheme({ ...theme, clockColor: value }, options);
      return;
    }
    if (isTitleConfigSlot(slot)) {
      setTheme({ ...theme, titleColors: { ...theme.titleColors, [titleSlotKey(slot)]: value } }, options);
      return;
    }
    if (isVoiceTranscriptConfigSlot(slot)) {
      setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, [voiceTranscriptSlotKey(slot)]: value } }, options);
      return;
    }
    if (isMapConfigSlot(slot)) {
      setTheme({ ...theme, map: { ...theme.map, [mapSlotKey(slot)]: value } }, options);
      return;
    }
    setThemeColor(slot, value, options);
  };

  const swapAccentHighlight = () => {
    setTheme({ ...theme, accent: theme.highlight, highlight: theme.accent });
  };

  // ---- Theme library (save / load / rename / duplicate / delete) ----------
  const activeEntry = useMemo(
    () => library.library.entries.find((entry) => entry.id === library.library.activeId) ?? null,
    [library.library],
  );
  const dirty = useMemo(
    () => (activeEntry ? themeSetSignature(themeSet) !== themeSetSignature(activeEntry.themeSet) : false),
    [activeEntry, themeSet],
  );

  const loadThemeFromLibrary = (id: string) => {
    const entry = library.library.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    setThemeSet(entry.themeSet);
    library.setActive(id);
  };

  // ---- Section copy / paste (type-guarded: map only pastes into map) -------
  const copySection = (kind: ThemeSectionKind) =>
    copySectionToClipboard({ kind, payload: extractSection(theme, kind) });
  const pasteSection = (kind: ThemeSectionKind) => {
    if (clipboard.section?.kind === kind) {
      setTheme(mergeSection(theme, kind, clipboard.section.payload));
    }
  };
  const sectionActions = (kind: ThemeSectionKind, label: string, extra?: ReactNode) => (
    <>
      {extra}
      <MomentaryFeedbackButton
        type="button"
        aria-label={`Copy ${label} section`}
        className="icon-link"
        data-demo-tooltip-title="Copy Section"
        data-demo-tooltip={`Copy every ${label} value to paste into another theme's ${label}.`}
        onClick={() => copySection(kind)}
      >
        <Copy className="h-5 w-5" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button"
        aria-label={`Paste ${label} section`}
        className="icon-link"
        disabled={clipboard.section?.kind !== kind}
        data-demo-tooltip-title="Paste Section"
        data-demo-tooltip={`Paste a copied ${label} into this theme.`}
        onClick={() => pasteSection(kind)}
      >
        <Clipboard className="h-5 w-5" />
      </MomentaryFeedbackButton>
    </>
  );

  // ---- Per-widget colour copy / paste (any colour into any widget) --------
  const copyColorForSlot = (slot: ThemeConfigSlot) => {
    const value = themeColorForSlot(theme, slot);
    const opacity = slot === "border"
      ? theme.border.opacity
      : slot === "map.water"
        ? theme.mapWater.opacity
        : undefined;
    copyColorToClipboard({ value, opacity });
  };
  const pasteColorIntoSlot = (slot: ThemeConfigSlot) => {
    const clip = clipboard.color;
    if (!clip) {
      return;
    }
    if (slot === "border") {
      setTheme({
        ...theme,
        border: {
          ...theme.border,
          color: clip.value,
          ...(clip.opacity !== undefined ? { opacity: clamp(Math.round(clip.opacity), 0, 100) } : {}),
        },
      });
      return;
    }
    if (slot === "map.water") {
      setTheme({
        ...theme,
        map: { ...theme.map, water: clip.value },
        ...(clip.opacity !== undefined
          ? { mapWater: { ...theme.mapWater, opacity: clamp(Math.round(clip.opacity), 0, 100) } }
          : {}),
      });
      return;
    }
    updateSlotColor(slot, clip.value);
  };

  const selectSlot = useCallback((slot: ThemeConfigSlot) => {
    setActiveSlot((current) => {
      const next = current === slot ? null : slot;
      writeSelectedConfigWidgetToStorage(next);
      return next;
    });
  }, []);

  const updateBorder = (border: ThemeBorderValue, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, border }, options);
  };

  const updateMapWater = (mapWater: ThemeMapLayerValue, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, mapWater }, options);
  };

  const updateStatusOrb = useCallback((avatar: NovaAvatarTheme, options: { persist?: boolean } = {}) => {
    setTheme({ ...theme, avatar }, options);
  }, [setTheme, theme]);

  const stopTaskAudioPreview = useCallback(() => {
    if (taskAudioPreviewStopTimer.current !== null) {
      window.clearTimeout(taskAudioPreviewStopTimer.current);
      taskAudioPreviewStopTimer.current = null;
    }

    const audio = taskAudioPreviewRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Some browsers will not allow seeking until the MP3 has loaded metadata.
      }
    }
  }, []);

  const previewTaskAudio = useCallback(() => {
    if (!taskReminderAudioExists) {
      return;
    }

    stopTaskAudioPreview();

    let audio = taskAudioPreviewRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      taskAudioPreviewRef.current = audio;
    }

    audio.src = `${TASK_REMINDER_AUDIO_PATH}?preview=${Date.now()}`;
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        console.info("[nova-dashboard] task preview audio blocked or unavailable", error);
      });
    }

    taskAudioPreviewStopTimer.current = window.setTimeout(stopTaskAudioPreview, TASK_GLOW_PREVIEW_MS);
  }, [stopTaskAudioPreview, taskReminderAudioExists]);

  const previewTaskGlow = useCallback(() => {
    if (taskGlowPreviewTimer.current !== null) {
      window.clearTimeout(taskGlowPreviewTimer.current);
    }

    previewTaskAudio();
    document.body.classList.remove("task-glow-preview");
    void document.body.offsetWidth;
    document.body.classList.add("task-glow-preview");
    taskGlowPreviewTimer.current = window.setTimeout(() => {
      document.body.classList.remove("task-glow-preview");
      taskGlowPreviewTimer.current = null;
    }, TASK_GLOW_PREVIEW_MS);
  }, [previewTaskAudio]);

  useEffect(() => {
    removeLegacyConfigWidgetParam();

    const onPageShow = () => setActiveSlot(selectedConfigWidgetFromStorage());
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    return () => {
      if (taskGlowPreviewTimer.current !== null) {
        window.clearTimeout(taskGlowPreviewTimer.current);
      }
      stopTaskAudioPreview();
      document.body.classList.remove("task-glow-preview");
    };
  }, [stopTaskAudioPreview]);

  useEffect(() => {
    if (theme.radarPaletteMode === "custom" || !isRadarPaletteSlot(activeSlot)) {
      return;
    }

    setActiveSlot(null);
    writeSelectedConfigWidgetToStorage(null);
  }, [activeSlot, theme.radarPaletteMode]);

  const renderWidget = (choice: ThemeSlotChoice) => {
    const value = themeColorForSlot(theme, choice.slot);
    const rgb = choice.slot === "border" ? borderRgb : appliedThemeRgb(value);
    const active = activeSlot === choice.slot;
    const isBuilding = choice.slot === "map.buildingLow" || choice.slot === "map.buildingHigh";
    const isLabels = choice.slot === "map.labels";
    const isWater = choice.slot === "map.water";
    return (
      <ColorWidget
        key={choice.slot}
        active={active}
        detail={choice.detail}
        label={choice.label}
        rgb={rgb}
        swatchOpacity={isWater ? (theme.mapWater.enabled ? Math.max(0.18, theme.mapWater.opacity / 100) : 0.24) : undefined}
        onToggle={() => selectSlot(choice.slot)}
        onCopyColor={() => copyColorForSlot(choice.slot)}
        onPasteColor={() => pasteColorIntoSlot(choice.slot)}
        pasteColorDisabled={!clipboard.color}
      >
        {choice.slot === "border" ? (
          <BorderToggle
            checked={theme.border.enabled}
            onChange={(enabled) => updateBorder({ ...theme.border, enabled })}
          />
        ) : null}
        {isWater ? (
          <WaterToggle
            checked={theme.mapWater.enabled}
            onChange={(enabled) => updateMapWater({ ...theme.mapWater, enabled })}
          />
        ) : null}
        <ColorSpectrum
          label={choice.label}
          value={value}
          onPreview={(nextValue) => updateSlotColor(choice.slot, nextValue, { persist: false })}
          onCommit={(nextValue) => updateSlotColor(choice.slot, nextValue)}
        />
        <ColorIntensitySlider
          label={choice.label}
          value={value}
          onPreview={(nextValue) => updateSlotColor(choice.slot, nextValue, { persist: false })}
          onCommit={(nextValue) => updateSlotColor(choice.slot, nextValue)}
        />
        {isLabels ? (
          <MapLabelSizeControl
            color={labelRgb}
            value={theme.mapLabelSize}
            onPreview={(mapLabelSize) => setTheme({ ...theme, mapLabelSize }, { persist: false })}
            onCommit={(mapLabelSize) => setTheme({ ...theme, mapLabelSize })}
          />
        ) : null}
        {isBuilding ? (
          <BuildingOpacityControl
            lowColor={buildingLowRgb}
            highColor={buildingHighRgb}
            value={theme.mapBuildingOpacity}
            onPreview={(mapBuildingOpacity) => setTheme({ ...theme, mapBuildingOpacity }, { persist: false })}
            onCommit={(mapBuildingOpacity) => setTheme({ ...theme, mapBuildingOpacity })}
          />
        ) : null}
        {isWater ? (
          <WaterOpacity
            water={theme.mapWater}
            color={waterRgb}
            onPreview={(mapWater) => updateMapWater(mapWater, { persist: false })}
            onCommit={updateMapWater}
          />
        ) : null}
        {choice.slot === "border" ? (
          <BorderOpacity
            border={theme.border}
            color={borderRgb}
            onPreview={(border) => updateBorder(border, { persist: false })}
            onCommit={updateBorder}
          />
        ) : null}
        {choice.slot === "voiceTranscript.text" ? (
          <>
            <SliderControlPanel
              activeColor={rgb}
              ariaLabel="Transcript text glow intensity"
              ariaValueText={`${theme.voiceTranscriptColors.glowIntensity}%`}
              color={rgb}
              label="Glow Intensity"
              max={VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX}
              min={VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN}
              step={1}
              value={theme.voiceTranscriptColors.glowIntensity}
              valueText={`${theme.voiceTranscriptColors.glowIntensity}%`}
              onPreview={(glowIntensity) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowIntensity } }, { persist: false })}
              onCommit={(glowIntensity) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowIntensity } })}
            />
            <SliderControlPanel
              activeColor={rgb}
              ariaLabel="Transcript text glow size"
              ariaValueText={`${theme.voiceTranscriptColors.glowSize}px`}
              color={rgb}
              label="Glow Size"
              max={VOICE_TRANSCRIPT_GLOW_SIZE_MAX}
              min={VOICE_TRANSCRIPT_GLOW_SIZE_MIN}
              step={1}
              value={theme.voiceTranscriptColors.glowSize}
              valueText={`${theme.voiceTranscriptColors.glowSize}px`}
              onPreview={(glowSize) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowSize } }, { persist: false })}
              onCommit={(glowSize) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, glowSize } })}
            />
          </>
        ) : null}
        {choice.slot === "voiceTranscript.background" ? (
          <>
            <SliderControlPanel
              activeColor={rgb}
              ariaLabel="Transcript scanline opacity"
              ariaValueText={`${theme.voiceTranscriptColors.scanlineOpacity}%`}
              color={rgb}
              label="Scanline Opacity"
              max={VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX}
              min={VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN}
              step={1}
              value={theme.voiceTranscriptColors.scanlineOpacity}
              valueText={`${theme.voiceTranscriptColors.scanlineOpacity}%`}
              onPreview={(scanlineOpacity) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineOpacity } }, { persist: false })}
              onCommit={(scanlineOpacity) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineOpacity } })}
            />
            <SliderControlPanel
              activeColor={rgb}
              ariaLabel="Transcript scanline scale"
              ariaValueText={`${theme.voiceTranscriptColors.scanlineScale}%`}
              color={rgb}
              label="Scanline Scale"
              max={VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX}
              min={VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN}
              step={5}
              value={theme.voiceTranscriptColors.scanlineScale}
              valueText={`${theme.voiceTranscriptColors.scanlineScale}%`}
              onPreview={(scanlineScale) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineScale } }, { persist: false })}
              onCommit={(scanlineScale) => setTheme({ ...theme, voiceTranscriptColors: { ...theme.voiceTranscriptColors, scanlineScale } })}
            />
          </>
        ) : null}
      </ColorWidget>
    );
  };

  return (
    <>
      <section
        className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl"
        style={{ visibility: mounted && themeReady ? "visible" : "hidden" }}
      >
        <div className="panel-corner panel-corner-left" />
        <div className="panel-corner panel-corner-right" />
        <div className="grid gap-4">
          <div className="grid gap-3">
            <h2 className="theme-display-label zone-title-bar">This Device</h2>
            <VoiceInputDeviceGroup agentName={agentName} />
            <CheckboxRow
              checked={autoFullscreen}
              label="Auto Fullscreen"
              detail={autoFullscreen ? `This device keeps ${agentName} fullscreen` : "This device opens without requesting fullscreen"}
              onChange={setAutoFullscreen}
            />
            <CheckboxRow
              checked={experienceFeatures.statusOrb}
              label="Show Status Orb"
              detail={
                experienceFeatures.statusOrb
                  ? "This device renders the animated status orb"
                  : "Status orb hidden — no canvas animation or load/gym polling"
              }
              onChange={(checked) => setExperienceFeature("statusOrb", checked)}
            />
            <CheckboxRow
              checked={statusOrbInfoVisible}
              label="Show Status Orb Info"
              detail={
                statusOrbInfoVisible
                  ? "Shows the information line inside the orb, including the gym count"
                  : "Status orb information is hidden on this device"
              }
              onChange={setStatusOrbInfoVisible}
            />
            <CheckboxRow
              checked={experienceFeatures.background}
              label="Show Background"
              detail={
                experienceFeatures.background
                  ? "This device renders the animated WebGL background"
                  : "Background off — the static themed grid remains for fast performance"
              }
              onChange={(checked) => setExperienceFeature("background", checked)}
            />
            <CheckboxRow
              checked={experienceFeatures.camera}
              label="Show Camera"
              detail={
                experienceFeatures.camera
                  ? "This device renders the live camera feed"
                  : "Camera off — skips hls.js video decode, one of the heaviest costs"
              }
              onChange={(checked) => setExperienceFeature("camera", checked)}
            />
            <CheckboxRow
              checked={experienceFeatures.worldMap}
              label="Show World Map"
              detail={
                experienceFeatures.worldMap
                  ? "This device renders the live maplibre map with radar"
                  : "Map off — a static “Map Offline” placeholder is shown instead"
              }
              onChange={(checked) => setExperienceFeature("worldMap", checked)}
            />
          </div>
          <div className="grid gap-3">
            <h2 className="theme-display-label zone-title-bar">Theme Library</h2>
            <CheckboxRow
              checked={followVisualizerWhenActive}
              label="Follow visualiser when active"
              detail={
                followVisualizerWhenActive
                  ? "Dashboard colours temporarily blend into the active visualiser theme"
                  : "Dashboard colours remain on the selected theme"
              }
              onChange={(checked) => void updateFollowVisualizerWhenActive(checked)}
            />
            {followVisualizerError ? <p className="theme-library-error">{followVisualizerError}</p> : null}
            <ThemeLibraryControl
              activeId={library.library.activeId}
              dirty={dirty}
              entries={library.library.entries}
              onLoad={loadThemeFromLibrary}
              onSaveChanges={() => library.saveChanges(themeSet)}
              onSaveAs={(name) => library.saveAs(name, themeSet)}
              onRename={(id, name) => library.rename(id, name)}
              onDuplicate={(id) => library.duplicate(id)}
              onDelete={(id) => library.remove(id)}
            />
            {library.error ? <p className="theme-library-error">{library.error}</p> : null}
          </div>
        </div>
      </section>

      <section
        className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl"
        style={{ visibility: mounted && themeReady ? "visible" : "hidden" }}
      >
        <div className="panel-corner panel-corner-left" />
        <div className="panel-corner panel-corner-right" />

        <div className="grid gap-4">
          <ThemeSelectionControl
            accentColor={accentRgb}
            highlightColor={highlightRgb}
            value={themeSet.selection}
            onPreview={(selection) => setThemeSelection(selection, { persist: false })}
            onCommit={setThemeSelection}
          />
          <ThemeVariantTabs value={editingVariant} onChange={setEditingVariant} />

          <div role="tabpanel" aria-label={`${THEME_VARIANT_LABELS[editingVariant]} theme settings`}>
            <ConfigAccordion title="Theme Settings" icon={<SlidersHorizontal className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-sub-accordion">
          <ConfigAccordion
            title="Theme Colours"
            icon={<Palette className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("themeColours", "theme colours", (
              <MomentaryFeedbackButton
                type="button"
                aria-label="Swap accent and highlight colours"
                className="icon-link"
                onClick={swapAccentHighlight}
              >
                <ArrowLeftRight className="h-5 w-5" />
              </MomentaryFeedbackButton>
            ))}
          >
            <div className="grid gap-3">
              <div className="theme-widget-flow">
                {THEME_SLOTS.map(renderWidget)}
              </div>
              <div className="theme-widget-flow">
                {VOICE_TRANSCRIPT_THEME_SLOTS.map(renderWidget)}
              </div>
              <TitleToneControl
                accentColor={accentRgb}
                highlightColor={highlightRgb}
                value={theme.titleTone}
                onPreview={(titleTone) => setTheme({ ...theme, titleTone }, { persist: false })}
                onCommit={(titleTone) => setTheme({ ...theme, titleTone })}
              />
              <div className="theme-widget-flow">
                {TITLE_THEME_SLOTS.map(renderWidget)}
              </div>
              {renderWidget(CLOCK_THEME_SLOT)}
            </div>
          </ConfigAccordion>

          <ConfigAccordion
            title="Fonts"
            icon={<Type className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("typography", "fonts")}
          >
            <div className="grid gap-4">
              <FontControl
                label="Theme Font"
                preview="Aa"
                sample="Aa Gg 0123"
                value={theme.font}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(font) => setTheme({ ...theme, font })}
                onPreview={(font) => setTheme({ ...theme, font }, { persist: false })}
              />
              <FontControl
                label="Clock Font"
                preview="12"
                sample="12:34"
                value={theme.clockFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(clockFont) => setTheme({ ...theme, clockFont })}
                onPreview={(clockFont) => setTheme({ ...theme, clockFont }, { persist: false })}
              />
              <FontControl
                label="Status Orb Label"
                preview="12"
                sample="12"
                value={theme.gymFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(gymFont) => setTheme({ ...theme, gymFont })}
                onPreview={(gymFont) => setTheme({ ...theme, gymFont }, { persist: false })}
              />
              <FontControl
                label="Voice Transcript"
                preview="Aa"
                sample="Aa Gg 0123"
                value={theme.transcriptFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(transcriptFont) => setTheme({ ...theme, transcriptFont })}
                onPreview={(transcriptFont) => setTheme({ ...theme, transcriptFont }, { persist: false })}
              />
            </div>
          </ConfigAccordion>

          <ConfigAccordion
            title="Status Orb"
            icon={<CircleDot className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("statusOrb", "status orb")}
          >
            <NovaAvatarConfig
              embedded
              theme={theme.avatar}
              onThemeChange={updateStatusOrb}
              onThemePreview={(avatar) => updateStatusOrb(avatar, { persist: false })}
            />
          </ConfigAccordion>

          <ConfigAccordion
            title="Background"
            icon={<ImageIcon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("background", "background")}
          >
            <DesktopWallpaperControl
              value={theme.desktopWallpaper}
              onChange={(desktopWallpaper) => setTheme({ ...theme, desktopWallpaper })}
            />
            <BackgroundEffectControls
              accentColor={accentRgb}
              highlightColor={highlightRgb}
              value={theme.backgroundEffect}
              onChange={(backgroundEffect) => setTheme({ ...theme, backgroundEffect })}
              onPreview={(backgroundEffect) => setTheme({ ...theme, backgroundEffect }, { persist: false })}
            />
          </ConfigAccordion>

          <ConfigAccordion
            title="Map"
            icon={<MapIcon className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("map", "map")}
          >
            <div className="grid gap-3">
              <CheckboxRow
                checked={theme.mapSatellite}
                label="Satellite Ground"
                detail={theme.mapSatellite ? "Tinted satellite imagery covers the map ground plane" : "Map ground uses the flat base and land use colours"}
                onChange={(mapSatellite) => setTheme({ ...theme, mapSatellite })}
              />
              <div className="theme-widget-flow">
                {MAP_THEME_SLOTS.map(renderWidget)}
              </div>
              <RadarPaletteModeControl
                lowColor={radarLowRgb}
                highColor={radarHighRgb}
                value={theme.radarPaletteMode}
                onPreview={(radarPaletteMode) => setTheme({ ...theme, radarPaletteMode }, { persist: false })}
                onCommit={(radarPaletteMode) => setTheme({ ...theme, radarPaletteMode })}
              />
              <RadarOpacityControl
                lowColor={radarLowRgb}
                highColor={radarHighRgb}
                value={theme.radarOpacity ?? RADAR_OPACITY_DEFAULT}
                onPreview={(radarOpacity) => setTheme({ ...theme, radarOpacity: normalizeRadarOpacity(radarOpacity) }, { persist: false })}
                onCommit={(radarOpacity) => setTheme({ ...theme, radarOpacity: normalizeRadarOpacity(radarOpacity) })}
              />
              {theme.radarPaletteMode === "custom" ? (
                <div className="theme-widget-flow">
                  {RADAR_THEME_SLOTS.map(renderWidget)}
                </div>
              ) : null}
            </div>
          </ConfigAccordion>

          <ConfigAccordion
            title="Reminders"
            icon={<Bell className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("reminders", "reminders")}
          >
            <div className="grid gap-3">
              <TaskGlowIntensityControl
                color={highlightRgb}
                value={theme.taskGlowIntensity ?? TASK_GLOW_INTENSITY_DEFAULT}
                onPreview={(taskGlowIntensity) => setTheme({ ...theme, taskGlowIntensity }, { persist: false })}
                onCommit={(taskGlowIntensity) => setTheme({ ...theme, taskGlowIntensity })}
                onReleased={previewTaskGlow}
              />
              <TaskReminderAudioControl onStatusChange={setTaskReminderAudioExists} />
            </div>
          </ConfigAccordion>

          <ConfigAccordion
            title="Sound"
            icon={<Volume2 className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
            className="config-sub-accordion"
            actions={sectionActions("sound", "sound")}
          >
            <ControlSoundConfig
              color={highlightRgb}
              value={theme.controlSound}
              onChange={(controlSound) => setTheme({ ...theme, controlSound })}
              onPreview={(controlSound) => setTheme({ ...theme, controlSound }, { persist: false })}
            />
          </ConfigAccordion>
            </ConfigAccordion>
          </div>
        </div>
      </section>
    </>
  );
}
