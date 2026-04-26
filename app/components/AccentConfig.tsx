"use client";

import { ArrowLeftRight, Check, Home, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DeviceTheme,
  MapThemeColorSlot,
  RADAR_OPACITY_DEFAULT,
  RADAR_OPACITY_MAX,
  RADAR_OPACITY_MIN,
  RadarPaletteMode,
  ThemeBorderValue,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeTitleTone,
  appliedThemeRgb,
  normalizeRadarOpacity,
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

  const { resetTheme, setTheme, setThemeColor, theme, themeReady } = useDeviceTheme(initialTheme);
  const [activeSlot, setActiveSlot] = useState<ThemeConfigSlot | null>(selectedConfigWidgetFromStorage);
  const accentRgb = appliedThemeRgb(theme.accent);
  const highlightRgb = appliedThemeRgb(theme.highlight);
  const borderRgb = appliedThemeRgb(theme.border.color);
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

  useEffect(() => {
    removeLegacyConfigWidgetParam();

    const onPageShow = () => setActiveSlot(selectedConfigWidgetFromStorage());
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

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
            style={{ backgroundColor: `rgb(${rgb.join(",")})` }}
          />
          <span className="theme-display-copy">
            <span className="theme-display-label zone-title-bar">{choice.label}</span>
            <span className="theme-display-detail">{choice.detail}</span>
            <span className="theme-display-rgb">
              {choice.slot === "border" && !theme.border.enabled ? "line default" : `rgb ${rgb.join(" ")}`}
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
              <AccentSpectrum label={choice.label} value={value} onChange={(nextValue) => updateSlotColor(choice.slot, nextValue)} />
              <AccentIntensity label={choice.label} value={value} onChange={(nextValue) => updateSlotColor(choice.slot, nextValue)} />
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
      <div className="dashboard-shell config-shell min-h-screen px-4 py-5 sm:px-6 lg:px-8">
        <div className="config-layout mx-auto grid max-w-5xl gap-5" style={{ visibility: themeReady ? "visible" : "hidden" }}>
          <section className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-5 shadow-2xl">
            <div className="panel-corner panel-corner-left" />
            <div className="panel-corner panel-corner-right" />

            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black uppercase text-cyan-300">Local Config</p>
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
              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Dashboard Behaviour</h2>
                <CheckboxRow
                  checked={theme.autoFullscreenOnLoad}
                  label="Auto Fullscreen"
                  detail={theme.autoFullscreenOnLoad ? "Requests fullscreen when the dashboard opens" : "Dashboard opens without requesting fullscreen"}
                  onChange={(autoFullscreenOnLoad) => setTheme({ ...theme, autoFullscreenOnLoad })}
                />
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
                <div className="theme-widget-grid grid gap-3 md:grid-cols-2">
                  {THEME_SLOTS.map(renderWidget)}
                </div>
              </section>

              <section className="theme-config-section grid gap-3">
                <h2 className="text-xl font-black uppercase text-neutral-100">Map Components</h2>
                <div className="theme-widget-grid grid gap-3 md:grid-cols-2">
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
                  <div className="theme-widget-grid grid gap-3 md:grid-cols-2">
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
