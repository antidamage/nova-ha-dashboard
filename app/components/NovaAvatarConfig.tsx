"use client";

import { useCallback } from "react";
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

function ColorBlock({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThemeColorValue;
  onChange: (value: ThemeColorValue) => void;
}) {
  return (
    <div className="nova-avatar-cfg-color-block">
      <NovaSpectrum label={label} value={value} onChange={onChange} />
      <NovaIntensity label={label} value={value} onChange={onChange} />
    </div>
  );
}

export function NovaAvatarConfig() {
  const { theme, setTheme, resetTheme } = useNovaAvatarTheme();

  const setSlot = useCallback(
    (slot: "gradientCenter" | "gradientOuter", value: ThemeColorValue) => {
      setTheme({ ...theme, [slot]: value });
    },
    [setTheme, theme],
  );

  const setLine = useCallback(
    (index: 0 | 1 | 2, value: ThemeColorValue) => {
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

  return (
    <section className="nova-avatar-cfg">
      <header className="nova-avatar-cfg-header">
        <div>
          <h2 className="nova-avatar-cfg-title">Nova avatar</h2>
          <p className="nova-avatar-cfg-subtitle">
            Background gradient and the three line colors. Updates live.
          </p>
        </div>
        <div className="nova-avatar-cfg-preview">
          <NovaAvatar size={150} forceVisible className="nova-avatar-cfg-preview-host" />
        </div>
      </header>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Background gradient</h3>
        <ColorBlock
          label="Gradient Center"
          value={theme.gradientCenter}
          onChange={(v) => setSlot("gradientCenter", v)}
        />
        <ColorBlock
          label="Gradient Outer"
          value={theme.gradientOuter}
          onChange={(v) => setSlot("gradientOuter", v)}
        />
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Line colors</h3>
        <ColorBlock
          label="Line 1"
          value={theme.lineColors[0]}
          onChange={(v) => setLine(0, v)}
        />
        <ColorBlock
          label="Line 2"
          value={theme.lineColors[1]}
          onChange={(v) => setLine(1, v)}
        />
        <ColorBlock
          label="Line 3"
          value={theme.lineColors[2]}
          onChange={(v) => setLine(2, v)}
        />
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

// Keeps DEFAULT export accessible for future code that wants to inspect defaults.
export { DEFAULT_NOVA_AVATAR_THEME };
