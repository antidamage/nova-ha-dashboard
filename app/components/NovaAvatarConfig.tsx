"use client";

import { useCallback, useState } from "react";
import {
  appliedThemeRgb,
  themeRgbAtPosition,
  type ThemeColorValue,
} from "./accentColor";
import { DotLineControl, DotSpectrumControl } from "./DotControls";
import {
  DEFAULT_NOVA_AVATAR_THEME,
  useNovaAvatarTheme,
  type NovaAvatarTheme,
} from "./novaAvatarTheme";
import NovaAvatar from "./NovaAvatar";

type AvatarSlot =
  | "gradientCenter"
  | "gradientOuter"
  | "line0"
  | "line1"
  | "line2";

type AvatarSlotChoice = { slot: AvatarSlot; label: string; detail: string };

const AVATAR_SLOTS: AvatarSlotChoice[] = [
  { slot: "gradientCenter", label: "Gradient Center", detail: "Inner glow" },
  { slot: "gradientOuter", label: "Gradient Outer", detail: "Outer falloff" },
  { slot: "line0", label: "Line 1", detail: "First arc colour" },
  { slot: "line1", label: "Line 2", detail: "Second arc colour" },
  { slot: "line2", label: "Line 3", detail: "Third arc colour" },
];

function NovaSpectrum({
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

function NovaIntensity({
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
      <div className="grid gap-4">
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
        <p className="text-4xl font-black tabular-nums text-neutral-50">{value.intensity}%</p>
      </div>
    </div>
  );
}

function readSlot(theme: NovaAvatarTheme, slot: AvatarSlot): ThemeColorValue {
  if (slot === "gradientCenter") return theme.gradientCenter;
  if (slot === "gradientOuter") return theme.gradientOuter;
  if (slot === "line0") return theme.lineColors[0];
  if (slot === "line1") return theme.lineColors[1];
  return theme.lineColors[2];
}

export function NovaAvatarConfig() {
  const { theme, setTheme, resetTheme } = useNovaAvatarTheme();
  const [activeSlot, setActiveSlot] = useState<AvatarSlot | null>(null);

  const writeSlot = useCallback(
    (slot: AvatarSlot, value: ThemeColorValue) => {
      if (slot === "gradientCenter") {
        setTheme({ ...theme, gradientCenter: value });
        return;
      }
      if (slot === "gradientOuter") {
        setTheme({ ...theme, gradientOuter: value });
        return;
      }
      const index = slot === "line0" ? 0 : slot === "line1" ? 1 : 2;
      const nextLines: NovaAvatarTheme["lineColors"] = [
        theme.lineColors[0],
        theme.lineColors[1],
        theme.lineColors[2],
      ];
      nextLines[index] = value;
      setTheme({ ...theme, lineColors: nextLines });
    },
    [setTheme, theme],
  );

  const selectSlot = useCallback((slot: AvatarSlot) => {
    setActiveSlot((current) => (current === slot ? null : slot));
  }, []);

  const renderWidget = (choice: AvatarSlotChoice) => {
    const value = readSlot(theme, choice.slot);
    const rgb = appliedThemeRgb(value);
    const active = activeSlot === choice.slot;

    return (
      <div
        key={choice.slot}
        className={`theme-widget-cell grid gap-3 ${active ? "theme-widget-cell-active" : ""}`}
      >
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
            <span className="theme-display-rgb">rgb {rgb.join(" ")}</span>
          </span>
        </button>

        {active ? (
          <div className="theme-inline-editor-reveal">
            <div className="theme-inline-editor grid gap-4 border border-cyan-300/30 bg-neutral-900/80 p-4">
              <NovaSpectrum
                label={choice.label}
                value={value}
                onChange={(next) => writeSlot(choice.slot, next)}
              />
              <NovaIntensity
                label={choice.label}
                value={value}
                onChange={(next) => writeSlot(choice.slot, next)}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="nova-avatar-cfg">
      <div className="nova-avatar-cfg-preview-wrap">
        <NovaAvatar size={150} forceVisible className="nova-avatar-cfg-preview-host" />
      </div>
      <header className="nova-avatar-cfg-header">
        <h2 className="nova-avatar-cfg-title">Nova</h2>
        <p className="nova-avatar-cfg-subtitle">
          Responsive host activity widget
        </p>
      </header>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Background gradient</h3>
        <div className="theme-widget-grid grid gap-3">
          {AVATAR_SLOTS.slice(0, 2).map(renderWidget)}
        </div>
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Line colors</h3>
        <div className="theme-widget-grid grid gap-3">
          {AVATAR_SLOTS.slice(2).map(renderWidget)}
        </div>
      </div>

      <div className="nova-avatar-cfg-actions">
        <button
          type="button"
          onClick={resetTheme}
          className="nova-avatar-cfg-reset"
        >
          Reset to defaults
        </button>
        <span className="nova-avatar-cfg-default-hint">
          (defaults: deep purple → black, blue / purple / cyan lines)
        </span>
      </div>
    </section>
  );
}

export { DEFAULT_NOVA_AVATAR_THEME };
