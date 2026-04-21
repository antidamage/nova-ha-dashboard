"use client";

import { ArrowLeftRight, Home, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";
import {
  DeviceTheme,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeTitleTone,
  appliedThemeRgb,
  themeRgbAtPosition,
  useDeviceTheme,
} from "./accentColor";
import { DotLineControl, DotSpectrumControl } from "./DotControls";

type ThemeConfigColorSlot = ThemeColorSlot | "background";

const THEME_SLOTS: Array<{ slot: ThemeConfigColorSlot; label: string; detail: string }> = [
  { slot: "accent", label: "Accent", detail: "Linework" },
  { slot: "highlight", label: "Highlight", detail: "Selection" },
  { slot: "background", label: "Background", detail: "Surfaces" },
];

const TITLE_TONES: Array<{ value: ThemeTitleTone; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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
            min={15}
            max={100}
            step={1}
            color={value.rgb}
            onChange={(intensity) => onChange({ ...value, intensity })}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{value.intensity}%</p>
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
        <p className="text-sm font-black uppercase text-cyan-200">Title Colour</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Title colour"
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

export function AccentConfig({ initialTheme }: { initialTheme?: Partial<DeviceTheme & ThemeColorValue> | null }) {
  const { resetTheme, setTheme, setThemeColor, theme, themeReady } = useDeviceTheme(initialTheme);
  const [activeSlot, setActiveSlot] = useState<ThemeConfigColorSlot>("accent");
  const activeChoice = THEME_SLOTS.find((choice) => choice.slot === activeSlot) ?? THEME_SLOTS[0];
  const activeColor = theme[activeSlot];
  const activeRgb = appliedThemeRgb(activeColor);
  const accentRgb = appliedThemeRgb(theme.accent);
  const highlightRgb = appliedThemeRgb(theme.highlight);

  const updateActiveColor = (value: ThemeColorValue) => {
    setThemeColor(activeSlot, value);
  };

  const swapAccentHighlight = () => {
    setTheme({ ...theme, accent: theme.highlight, highlight: theme.accent });
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
                <a className="icon-link" href="/" aria-label="Back to dashboard">
                  <Home className="h-7 w-7" />
                </a>
                <button className="icon-link" type="button" aria-label="Reset theme colors" onClick={resetTheme}>
                  <RotateCcw className="h-7 w-7" />
                </button>
              </div>
            </header>

            <div className="grid gap-5">
              <div className="theme-display grid gap-3 sm:grid-cols-[1fr_auto_1fr_1fr] sm:items-stretch">
                {THEME_SLOTS.map((choice, index) => {
                  const rgb = appliedThemeRgb(theme[choice.slot]);

                  return (
                    <Fragment key={choice.slot}>
                      <button
                        type="button"
                        aria-pressed={activeSlot === choice.slot}
                        className={`theme-display-card border p-4 text-left ${activeSlot === choice.slot ? "theme-display-card-active" : ""}`}
                        onClick={() => setActiveSlot(choice.slot)}
                      >
                        <span
                          className="theme-display-swatch border"
                          style={{ backgroundColor: `rgb(${rgb.join(",")})` }}
                        />
                        <span className="theme-display-copy">
                          <span className="theme-display-label">{choice.label}</span>
                          <span className="theme-display-detail">{choice.detail}</span>
                          <span className="theme-display-rgb">rgb {rgb.join(" ")}</span>
                        </span>
                      </button>
                      {index === 0 && (
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            aria-label="Swap accent and highlight colours"
                            className="icon-link"
                            onClick={swapAccentHighlight}
                          >
                            <ArrowLeftRight className="h-5 w-5" />
                          </button>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>

              <div className="theme-choice-tabs grid grid-cols-3 gap-3">
                {THEME_SLOTS.map((choice) => (
                  <button
                    key={choice.slot}
                    type="button"
                    aria-pressed={activeSlot === choice.slot}
                    className={`theme-choice-tab border px-4 py-3 ${activeSlot === choice.slot ? "theme-choice-tab-active" : ""}`}
                    onClick={() => setActiveSlot(choice.slot)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>

              <AccentSpectrum label={activeChoice.label} value={activeColor} onChange={updateActiveColor} />
              <AccentIntensity label={activeChoice.label} value={activeColor} onChange={updateActiveColor} />
              <TitleToneControl
                accentColor={accentRgb}
                highlightColor={highlightRgb}
                value={theme.titleTone}
                onChange={(titleTone) => setTheme({ ...theme, titleTone })}
              />

              <div className="accent-readout grid gap-4 border border-neutral-700 bg-neutral-950/70 p-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center">
                <div
                  className="accent-swatch h-24 border border-neutral-600"
                  style={{ backgroundColor: `rgb(${activeRgb.join(",")})` }}
                />
                <div className="grid gap-2">
                  <p className="text-sm font-black uppercase text-cyan-300">Editing {activeChoice.label}</p>
                  <p className="font-mono text-2xl font-black tabular-nums text-neutral-50">rgb {activeRgb.join(" ")}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
