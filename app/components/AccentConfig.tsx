"use client";

import { ArrowLeftRight, Check, Home, Music, RotateCcw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceTheme,
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
  TASK_GLOW_INTENSITY_DEFAULT,
  TASK_GLOW_INTENSITY_MAX,
  TASK_GLOW_INTENSITY_MIN,
  ThemeBorderValue,
  ThemeColorSlot,
  ThemeConfigScope,
  ThemeColorValue,
  ThemeMapLayerValue,
  ThemeTitleTone,
  appliedThemeRgb,
  normalizeRadarOpacity,
  normalizeTaskGlowIntensity,
  themeRgbAtPosition,
  useDeviceTheme,
} from "./accentColor";
import { DotLineControl, DotSpectrumControl } from "./DotControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { useBuildReload } from "./useBuildReload";

type ThemeConfigColorSlot = ThemeColorSlot | "background";
type MapConfigSlot = `map.${MapThemeColorSlot}`;
type ThemeConfigSlot = ThemeConfigColorSlot | "border" | MapConfigSlot;
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

const ALL_THEME_SLOTS = [...THEME_SLOTS, ...MAP_THEME_SLOTS, ...RADAR_THEME_SLOTS];

const RADAR_PALETTE_MODES: Array<{ value: RadarPaletteMode; label: string }> = [
  { value: "spectrum", label: "Spectrum" },
  { value: "custom", label: "Custom" },
];

const TITLE_TONES: Array<{ value: ThemeTitleTone; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const CONFIG_SCOPES: Array<{ value: ThemeConfigScope; label: string; detail: string }> = [
  { value: "local", label: "Local", detail: "This client" },
  { value: "shared", label: "Shared", detail: "Host settings" },
];

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

const CONFIG_WIDGET_STORAGE_KEY = "nova.dashboard.configWidget.v1";
const TASK_GLOW_PREVIEW_MS = 2600;
const TASK_REMINDER_AUDIO_PATH = "/api/tasks/audio";

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

function AccentSpectrum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThemeColorValue;
  onChange: (value: ThemeColorValue) => void;
}) {
  const displayRgb = appliedThemeRgb(value);

  return (
    <div>
      <DotSpectrumControl
        ariaLabel={`${label} color spectrum`}
        cursor={value.cursor}
        intensity={value.intensity}
        rgbAtPosition={themeRgbAtPosition}
        onChange={(cursor, rgb) => onChange({ ...value, cursor, rgb })}
      />
      <div className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-300">
        <span className="uppercase text-fuchsia-200">{label}</span>
        <span className="tabular-nums text-neutral-400">rgb {displayRgb.join(" ")}</span>
      </div>
    </div>
  );
}

function AccentIntensity({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThemeColorValue;
  onChange: (value: ThemeColorValue) => void;
}) {
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Intensity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel={`${label} intensity`}
            ariaValueText={`${value.intensity}%`}
            value={value.intensity}
            min={0}
            max={100}
            step={1}
            color={value.rgb}
            intensity={value.intensity}
            onChange={(intensity) => onChange({ ...value, intensity })}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{value.intensity}%</p>
      </div>
    </div>
  );
}

function BorderOpacity({
  border,
  color,
  onChange,
}: {
  border: ThemeBorderValue;
  color: [number, number, number];
  onChange: (border: ThemeBorderValue) => void;
}) {
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Opacity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Border opacity"
            ariaValueText={`${border.opacity}%`}
            value={border.opacity}
            min={0}
            max={100}
            step={1}
            color={color}
            activeColor={color}
            dotOpacity={border.opacity / 100}
            onChange={(opacity) => onChange({ ...border, opacity })}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{border.opacity}%</p>
      </div>
    </div>
  );
}

function CheckboxRow({
  checked,
  detail,
  label,
  onChange,
}: {
  checked: boolean;
  detail: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`cyber-checkbox-row border p-4 text-left ${checked ? "cyber-checkbox-row-active" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true">
        {checked && <Check className="h-6 w-6" strokeWidth={3} />}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="theme-display-label zone-title-bar">{label}</span>
        <span className="theme-display-detail">{detail}</span>
      </span>
    </MomentaryFeedbackButton>
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

function ConfigScopeSwitch({
  onChange,
  value,
}: {
  onChange: (value: ThemeConfigScope) => void;
  value: ThemeConfigScope;
}) {
  return (
    <section className="theme-config-section grid gap-3">
      <h2 className="text-xl font-black uppercase text-neutral-100">Config Source</h2>
      <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Config source">
        {CONFIG_SCOPES.map((scope) => {
          const active = value === scope.value;

          return (
            <MomentaryFeedbackButton
              key={scope.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`theme-choice-tab border p-4 text-left ${active ? "theme-choice-tab-active" : ""}`}
              onClick={() => onChange(scope.value)}
            >
              <span className="grid min-w-0 gap-1">
                <span className="theme-display-label zone-title-bar">{scope.label}</span>
                <span className="theme-display-detail">{scope.detail}</span>
              </span>
            </MomentaryFeedbackButton>
          );
        })}
      </div>
    </section>
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
  onChange,
  water,
}: {
  color: [number, number, number];
  onChange: (water: ThemeMapLayerValue) => void;
  water: ThemeMapLayerValue;
}) {
  const opacity = clamp(Math.round(Number(water.opacity)), 0, 100);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Water Opacity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Water opacity"
            ariaValueText={`${opacity}%`}
            value={opacity}
            min={0}
            max={100}
            step={1}
            color={color}
            activeColor={color}
            dotOpacity={opacity / 100}
            onChange={(nextOpacity) => onChange({ ...water, opacity: nextOpacity })}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{opacity}%</p>
      </div>
    </div>
  );
}

function MapLabelSizeControl({
  color,
  onChange,
  value,
}: {
  color: [number, number, number];
  onChange: (value: number) => void;
  value: number;
}) {
  const labelSize = clamp(Math.round(Number(value)), MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Label Size</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Map label size"
            ariaValueText={`${labelSize}%`}
            value={labelSize}
            min={MAP_LABEL_SIZE_MIN}
            max={MAP_LABEL_SIZE_MAX}
            step={50}
            color={color}
            activeColor={color}
            onChange={onChange}
            markers={[
              { active: labelSize === MAP_LABEL_SIZE_MIN, label: "Min", value: MAP_LABEL_SIZE_MIN },
              { active: labelSize === MAP_LABEL_SIZE_DEFAULT, label: "Default", value: MAP_LABEL_SIZE_DEFAULT },
              { active: labelSize === MAP_LABEL_SIZE_MAX, label: "Max", value: MAP_LABEL_SIZE_MAX },
            ]}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{labelSize}%</p>
      </div>
    </div>
  );
}

function BuildingOpacityControl({
  highColor,
  lowColor,
  onChange,
  value,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  onChange: (value: number) => void;
  value: number;
}) {
  const opacity = clamp(Math.round(Number(value)), MAP_BUILDING_OPACITY_MIN, MAP_BUILDING_OPACITY_MAX);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Building Opacity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Building opacity"
            ariaValueText={`${opacity}%`}
            value={opacity}
            min={MAP_BUILDING_OPACITY_MIN}
            max={MAP_BUILDING_OPACITY_MAX}
            step={1}
            color={lowColor}
            activeColor={highColor}
            dotOpacity={opacity / 100}
            onChange={onChange}
            markers={[
              { active: opacity === MAP_BUILDING_OPACITY_DEFAULT, label: "Default", value: MAP_BUILDING_OPACITY_DEFAULT },
              { active: opacity === MAP_BUILDING_OPACITY_MAX, label: "Max", value: MAP_BUILDING_OPACITY_MAX },
            ]}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{opacity}%</p>
      </div>
    </div>
  );
}

function TitleToneControl({
  accentColor,
  highlightColor,
  value,
  onChange,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  value: ThemeTitleTone;
  onChange: (value: ThemeTitleTone) => void;
}) {
  const activeIndex = Math.max(0, TITLE_TONES.findIndex((tone) => tone.value === value));
  const activeLabel = TITLE_TONES[activeIndex]?.label ?? "Auto";

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Text Tone</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Text tone"
            ariaValueText={activeLabel}
            value={activeIndex}
            min={0}
            max={TITLE_TONES.length - 1}
            step={1}
            color={accentColor}
            activeColor={highlightColor}
            onChange={(index) => onChange(TITLE_TONES[Math.round(index)]?.value ?? "auto")}
            markers={TITLE_TONES.map((tone, index) => ({
              active: tone.value === value,
              label: tone.label,
              value: index,
            }))}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{activeLabel}</p>
      </div>
    </div>
  );
}

function RadarPaletteModeControl({
  highColor,
  lowColor,
  value,
  onChange,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  value: RadarPaletteMode;
  onChange: (value: RadarPaletteMode) => void;
}) {
  const activeIndex = Math.max(0, RADAR_PALETTE_MODES.findIndex((mode) => mode.value === value));
  const activeLabel = RADAR_PALETTE_MODES[activeIndex]?.label ?? "Spectrum";

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_112px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Radar Palette</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Radar palette mode"
            ariaValueText={activeLabel}
            value={activeIndex}
            min={0}
            max={RADAR_PALETTE_MODES.length - 1}
            step={1}
            color={lowColor}
            activeColor={highColor}
            onChange={(index) => onChange(RADAR_PALETTE_MODES[Math.round(index)]?.value ?? "spectrum")}
            markers={RADAR_PALETTE_MODES.map((mode, index) => ({
              active: mode.value === value,
              label: mode.label,
              value: index,
            }))}
          />
        </div>
        <p className="text-3xl font-black uppercase text-neutral-50 md:text-right">{activeLabel}</p>
      </div>
    </div>
  );
}

function RadarOpacityControl({
  highColor,
  lowColor,
  value,
  onChange,
}: {
  highColor: [number, number, number];
  lowColor: [number, number, number];
  value: number;
  onChange: (value: number) => void;
}) {
  const opacity = normalizeRadarOpacity(value);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_112px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Radar Opacity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Radar overlay opacity"
            ariaValueText={`${opacity}%`}
            value={opacity}
            min={RADAR_OPACITY_MIN}
            max={RADAR_OPACITY_MAX}
            step={1}
            color={lowColor}
            activeColor={highColor}
            onChange={(nextValue) => onChange(nextValue)}
          />
        </div>
        <p className="text-3xl font-black tabular-nums text-neutral-50 md:text-right">{opacity}%</p>
      </div>
    </div>
  );
}

function TaskGlowIntensityControl({
  color,
  onChange,
  onPreview,
  value,
}: {
  color: [number, number, number];
  onChange: (value: number) => void;
  onPreview: () => void;
  value: number;
}) {
  const intensity = normalizeTaskGlowIntensity(value);

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_112px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Reminder Glow</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Task reminder glow intensity"
            ariaValueText={`${intensity}%`}
            value={intensity}
            min={TASK_GLOW_INTENSITY_MIN}
            max={TASK_GLOW_INTENSITY_MAX}
            step={10}
            color={color}
            activeColor={color}
            intensity={Math.min(100, intensity)}
            onChange={(nextValue) => onChange(normalizeTaskGlowIntensity(nextValue))}
            onCommit={onPreview}
            markers={[
              { active: intensity === TASK_GLOW_INTENSITY_DEFAULT, label: "Default", value: TASK_GLOW_INTENSITY_DEFAULT },
              { active: intensity === TASK_GLOW_INTENSITY_MAX, label: "Max", value: TASK_GLOW_INTENSITY_MAX },
            ]}
          />
        </div>
        <p className="text-3xl font-black tabular-nums text-neutral-50 md:text-right">{intensity}%</p>
      </div>
    </div>
  );
}

type BackgroundEffectKey = keyof FluidBackgroundSettings;

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

function BackgroundEffectControls({
  accentColor,
  highlightColor,
  onChange,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onChange: (value: FluidBackgroundSettings) => void;
  value: FluidBackgroundSettings;
}) {
  return (
    <div className="grid gap-3">
      {BACKGROUND_EFFECT_CONTROLS.map((control) => {
        const currentValue = value[control.key];
        const displayValue = control.valueText(currentValue);

        return (
          <div key={control.key} className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)_112px] md:items-center">
              <p className="text-sm font-black uppercase text-cyan-200">{control.label}</p>
              <div className="px-1">
                <DotLineControl
                  ariaLabel={`Apple TV background ${control.label.toLowerCase()}`}
                  ariaValueText={displayValue}
                  value={currentValue}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  color={accentColor}
                  activeColor={highlightColor}
                  intensity={Math.min(100, Math.max(40, currentValue))}
                  onChange={(nextValue) => onChange({ ...value, [control.key]: nextValue })}
                  markers={[
                    { active: currentValue === control.defaultValue, label: "Default", value: control.defaultValue },
                    { active: currentValue === control.max, label: "Max", value: control.max },
                  ]}
                />
              </div>
              <p className="text-3xl font-black tabular-nums text-neutral-50 md:text-right">{displayValue}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TaskReminderAudioStatus = {
  exists: boolean;
  size?: number;
  updatedAt?: string;
};

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
      const response = await fetch("/api/tasks/audio?status=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to read reminder audio");
      }
      const nextStatus = payload as TaskReminderAudioStatus;
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
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/tasks/audio", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to upload reminder audio");
      }

      const nextStatus = payload as TaskReminderAudioStatus;
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
      const response = await fetch("/api/tasks/audio", { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove reminder audio");
      }
      const nextStatus = payload as TaskReminderAudioStatus;
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

function themeColorForSlot(theme: DeviceTheme, slot: ThemeConfigSlot): ThemeColorValue {
  if (slot === "border") {
    return theme.border.color;
  }
  if (isMapConfigSlot(slot)) {
    return theme.map[mapSlotKey(slot)];
  }
  return theme[slot];
}

export function AccentConfig({ initialTheme }: { initialTheme?: Partial<DeviceTheme & ThemeColorValue> | null }) {
  useBuildReload();

  const { resetTheme, setTheme, setThemeColor, setThemeScope, theme, themeReady, themeScope } = useDeviceTheme(initialTheme);
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

  const updateSlotColor = (slot: ThemeConfigSlot, value: ThemeColorValue) => {
    if (slot === "border") {
      setTheme({ ...theme, border: { ...theme.border, color: value } });
      return;
    }
    if (isMapConfigSlot(slot)) {
      setTheme({ ...theme, map: { ...theme.map, [mapSlotKey(slot)]: value } });
      return;
    }
    setThemeColor(slot, value);
  };

  const swapAccentHighlight = () => {
    setTheme({ ...theme, accent: theme.highlight, highlight: theme.accent });
  };

  const selectSlot = useCallback((slot: ThemeConfigSlot) => {
    setActiveSlot((current) => {
      const next = current === slot ? null : slot;
      writeSelectedConfigWidgetToStorage(next);
      return next;
    });
  }, []);

  const updateBorder = (border: ThemeBorderValue) => {
    setTheme({ ...theme, border });
  };

  const updateMapWater = (mapWater: ThemeMapLayerValue) => {
    setTheme({ ...theme, mapWater });
  };

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
      <div key={choice.slot} className={`theme-widget-cell grid gap-3 ${active ? "theme-widget-cell-active" : ""}`}>
        <button
          type="button"
          aria-pressed={active}
          className={`theme-display-card border p-4 text-left ${active ? "theme-display-card-active" : ""}`}
          onClick={() => selectSlot(choice.slot)}
        >
          <span
            className="theme-display-swatch border"
            style={{
              backgroundColor: `rgb(${rgb.join(",")})`,
              opacity: isWater ? (theme.mapWater.enabled ? Math.max(0.18, theme.mapWater.opacity / 100) : 0.24) : undefined,
            }}
          />
          <span className="theme-display-copy">
            <span className="theme-display-label zone-title-bar">{choice.label}</span>
            <span className="theme-display-detail">{choice.detail}</span>
            <span className="theme-display-rgb">
              {choice.slot === "border" && !theme.border.enabled
                ? "line default"
                : isWater
                  ? theme.mapWater.enabled
                    ? `rgb ${rgb.join(" ")} / ${theme.mapWater.opacity}%`
                    : "water disabled"
                  : `rgb ${rgb.join(" ")}`}
            </span>
          </span>
        </button>

        {active ? (
          <div className="theme-inline-editor-reveal">
            <div className="theme-inline-editor grid gap-4 border border-cyan-300/30 bg-neutral-900/80 p-4">
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
              <AccentSpectrum label={choice.label} value={value} onChange={(nextValue) => updateSlotColor(choice.slot, nextValue)} />
              <AccentIntensity label={choice.label} value={value} onChange={(nextValue) => updateSlotColor(choice.slot, nextValue)} />
              {isLabels ? (
                <MapLabelSizeControl
                  color={labelRgb}
                  value={theme.mapLabelSize}
                  onChange={(mapLabelSize) => setTheme({ ...theme, mapLabelSize })}
                />
              ) : null}
              {isBuilding ? (
                <BuildingOpacityControl
                  lowColor={buildingLowRgb}
                  highColor={buildingHighRgb}
                  value={theme.mapBuildingOpacity}
                  onChange={(mapBuildingOpacity) => setTheme({ ...theme, mapBuildingOpacity })}
                />
              ) : null}
              {isWater ? (
                <WaterOpacity water={theme.mapWater} color={waterRgb} onChange={updateMapWater} />
              ) : null}
              {choice.slot === "border" ? (
                <BorderOpacity border={theme.border} color={borderRgb} onChange={updateBorder} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <main className="min-h-screen text-neutral-100" style={{ backgroundColor: "var(--cyber-bg)" }}>
      <div className="dashboard-shell config-shell min-h-screen px-4 py-5 sm:px-6">
        <div className="config-layout mx-auto grid max-w-5xl gap-5" style={{ visibility: themeReady ? "visible" : "hidden" }}>
          <section className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-5 shadow-2xl">
            <div className="panel-corner panel-corner-left" />
            <div className="panel-corner panel-corner-right" />

            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black uppercase text-cyan-300">Config</p>
                <h1 className="mt-1 text-4xl font-black uppercase text-neutral-50 sm:text-5xl">Theme</h1>
              </div>
              <div className="config-actions grid grid-cols-2 gap-3">
                <a className="icon-link icon-link-text-tone" href="/" aria-label="Back to dashboard">
                  <Home className="h-7 w-7" />
                </a>
                <MomentaryFeedbackButton className="icon-link" type="button" aria-label="Reset theme colors" onClick={resetTheme}>
                  <RotateCcw className="h-7 w-7" />
                </MomentaryFeedbackButton>
              </div>
            </header>

            <div className="grid gap-5">
              <ConfigScopeSwitch value={themeScope} onChange={setThemeScope} />

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Dashboard Behaviour</h2>
                <CheckboxRow
                  checked={theme.autoFullscreenOnLoad}
                  label="Auto Fullscreen"
                  detail={theme.autoFullscreenOnLoad ? "Local client requests fullscreen when the dashboard opens" : "Local client opens without requesting fullscreen"}
                  onChange={(autoFullscreenOnLoad) => setTheme({ ...theme, autoFullscreenOnLoad })}
                />
              </section>

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Apple TV Background</h2>
                <BackgroundEffectControls
                  accentColor={accentRgb}
                  highlightColor={highlightRgb}
                  value={theme.backgroundEffect}
                  onChange={(backgroundEffect) => setTheme({ ...theme, backgroundEffect })}
                />
              </section>

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Tasks</h2>
                <TaskGlowIntensityControl
                  color={highlightRgb}
                  value={theme.taskGlowIntensity ?? TASK_GLOW_INTENSITY_DEFAULT}
                  onChange={(taskGlowIntensity) => setTheme({ ...theme, taskGlowIntensity })}
                  onPreview={previewTaskGlow}
                />
                <TaskReminderAudioControl onStatusChange={setTaskReminderAudioExists} />
              </section>

              <section className="theme-config-section grid gap-3">
                <div className="theme-config-heading flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black uppercase text-neutral-100">Dashboard Components</h2>
                  <MomentaryFeedbackButton
                    type="button"
                    aria-label="Swap accent and highlight colours"
                    className="icon-link"
                    onClick={swapAccentHighlight}
                  >
                    <ArrowLeftRight className="h-5 w-5" />
                  </MomentaryFeedbackButton>
                </div>
                <div className="theme-widget-grid grid gap-3">
                  {THEME_SLOTS.map(renderWidget)}
                </div>
              </section>

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Map Components</h2>
                <CheckboxRow
                  checked={theme.mapSatellite}
                  label="Satellite Ground"
                  detail={theme.mapSatellite ? "Tinted satellite imagery covers the map ground plane" : "Map ground uses the flat base and land use colours"}
                  onChange={(mapSatellite) => setTheme({ ...theme, mapSatellite })}
                />
                <div className="theme-widget-grid grid gap-3">
                  {MAP_THEME_SLOTS.map(renderWidget)}
                </div>
              </section>

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Rain Radar</h2>
                <RadarPaletteModeControl
                  lowColor={radarLowRgb}
                  highColor={radarHighRgb}
                  value={theme.radarPaletteMode}
                  onChange={(radarPaletteMode) => setTheme({ ...theme, radarPaletteMode })}
                />
                <RadarOpacityControl
                  lowColor={radarLowRgb}
                  highColor={radarHighRgb}
                  value={theme.radarOpacity ?? RADAR_OPACITY_DEFAULT}
                  onChange={(radarOpacity) => setTheme({ ...theme, radarOpacity: normalizeRadarOpacity(radarOpacity) })}
                />
                {theme.radarPaletteMode === "custom" ? (
                  <div className="theme-widget-grid grid gap-3">
                    {RADAR_THEME_SLOTS.map(renderWidget)}
                  </div>
                ) : null}
              </section>

              <TitleToneControl
                accentColor={accentRgb}
                highlightColor={highlightRgb}
                value={theme.titleTone}
                onChange={(titleTone) => setTheme({ ...theme, titleTone })}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
