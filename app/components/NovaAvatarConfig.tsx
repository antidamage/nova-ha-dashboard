"use client";

import { Check, ChevronDown, CircleDot } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveOrbModuleSettings, type OrbModule } from "../../lib/orb-modules";
import { appliedThemeRgb, type ThemeColorValue } from "./accentColor";
import {
  ColorIntensitySlider,
  ColorSpectrum,
  ColorWidget,
  ConfigAccordion,
  SliderControlPanel,
} from "./ConfigControls";
import {
  DEFAULT_NOVA_AVATAR_THEME,
  normalizeNovaAvatarTheme,
  type NovaAvatarTheme,
} from "./avatarThemeModel";
import { useLegacyNovaAvatarTheme } from "./novaAvatarTheme";
import NovaAvatar from "./NovaAvatar";
import { buildOrbPalette, useOrbModule, useOrbModules } from "./orbModules";
import { createOrbRenderer } from "./orbRenderer";
import { useAgentName } from "./AgentNameContext";
import { useSelectMenu } from "./useSelectMenu";

type AvatarSlot =
  | "gradientAlert"
  | "gradientCenter"
  | "gradientOuter"
  | "gymNumber"
  | "voiceGlow"
  | "line0"
  | "line1"
  | "line2";

type AvatarSlotChoice = { slot: AvatarSlot; label: string; detail: string };

const AVATAR_SLOTS: AvatarSlotChoice[] = [
  { slot: "gradientCenter", label: "Gradient Center", detail: "Inner glow" },
  { slot: "gradientOuter", label: "Gradient Outer", detail: "Outer falloff" },
  { slot: "gymNumber", label: "Status Orb Label", detail: "Counter colour" },
  { slot: "gradientAlert", label: "Alert", detail: "Gym overdue pulse" },
  { slot: "voiceGlow", label: "Voice Glow", detail: "Listening halo" },
  { slot: "line0", label: "Line 1", detail: "First arc colour" },
  { slot: "line1", label: "Line 2", detail: "Second arc colour" },
  { slot: "line2", label: "Line 3", detail: "Third arc colour" },
];

function NovaOpacity({
  color,
  label,
  onCommit,
  onPreview,
  value,
}: {
  color: ThemeColorValue;
  label: string;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  value: number;
}) {
  const displayRgb = appliedThemeRgb(color);

  return (
    <SliderControlPanel
      ariaLabel={`${label} opacity`}
      ariaValueText={`${value}%`}
      color={displayRgb}
      dotOpacity={Math.max(0.18, value / 100)}
      intensity={100}
      label="Opacity"
      max={100}
      min={0}
      step={1}
      value={value}
      valueText={`${value}%`}
      onPreview={onPreview}
      onCommit={onCommit}
    />
  );
}

/** Swatch render size in CSS pixels (the trigger slot is 44px). */
const ORB_SWATCH_SIZE = 44;

/**
 * Static thumbnail of an orb module rendered with the theme being edited.
 * Uses the real module renderer (one short simulated run so the animated
 * field layers reach a representative pose, keeping only the final frame),
 * so every dropdown option previews its actual geometry in the user's
 * current colors — the orb-module equivalent of the theme library's
 * color-band swatch.
 */
function OrbModuleSwatch({ module, theme }: { module: OrbModule; theme: NovaAvatarTheme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Setting the bitmap size also resets the context transform/state, so
    // repeated effect runs (theme edits) never accumulate scale.
    canvas.width = ORB_SWATCH_SIZE * dpr;
    canvas.height = ORB_SWATCH_SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const renderer = createOrbRenderer(module);
    const palette = buildOrbPalette(theme);
    // Simulate ~2s at moderate load so arcField/lineField segments grow into
    // a recognizable pose; only the last frame stays on the canvas.
    for (let i = 0; i <= 40; i += 1) {
      ctx.clearRect(0, 0, ORB_SWATCH_SIZE, ORB_SWATCH_SIZE);
      renderer.render(ctx, {
        centerX: ORB_SWATCH_SIZE / 2,
        centerY: ORB_SWATCH_SIZE / 2,
        radiusPx: ORB_SWATCH_SIZE * 0.48,
        palette,
        load: 0.6,
        alertActive: false,
        nowMs: i * 50,
        dtSec: 0.05,
      });
    }
  }, [module, theme]);

  // Display size comes from the cyber-select-swatch class (44px in the
  // trigger, 34px inside menu options), scaling the fixed 44px bitmap.
  return <canvas ref={canvasRef} className="cyber-select-swatch" aria-hidden="true" />;
}

/**
 * Drop-down selector for the status orb module (the layer stack the orb
 * draws with), styled after the theme library's cyber-select control. Lists
 * every module known to the host — built-ins plus any JSON files dropped
 * into `config/orb-modules/` — and writes the chosen id to the theme's
 * `avatar.orbModule`, so the orb style is part of the dark/light theme like
 * every other Status Orb setting.
 */
function OrbModuleSelect({
  onChange,
  theme,
  value,
}: {
  onChange: (id: string) => void;
  theme: NovaAvatarTheme;
  value: string;
}) {
  const modules = useOrbModules();
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  // Outside-click/Escape close plus the portalled, always-on-top menu — same
  // behaviour as the theme library dropdown this control is copied from.
  const { containerRef, menuRef, menuStyle } = useSelectMenu(open, setOpen);

  const active = modules.find((module) => module.id === value) ?? null;

  return (
    <div className="theme-library-select" ref={containerRef}>
      <button
        type="button"
        className={`cyber-select-trigger ${open ? "cyber-select-trigger-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        {active
          ? <OrbModuleSwatch module={active} theme={theme} />
          : <span className="cyber-select-swatch cyber-select-swatch-empty" aria-hidden="true" />}
        <span className="cyber-select-trigger-copy">
          <span className="cyber-select-trigger-name zone-title-bar">{active ? active.name : value}</span>
          <span className="cyber-select-trigger-detail">
            {active ? active.description : "Module not available on this host yet"}
          </span>
        </span>
        <ChevronDown className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`} aria-hidden="true" />
      </button>

      {open && menuStyle ? createPortal(
        <ul
          ref={menuRef}
          className="cyber-select-menu cyber-select-menu-portal"
          id={listboxId}
          role="listbox"
          aria-label="Status orb module"
          style={menuStyle}
        >
          {modules.map((module) => {
            const selected = module.id === value;
            return (
              <li key={module.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={`cyber-select-option ${selected ? "cyber-select-option-active" : ""}`}
                  onClick={() => {
                    onChange(module.id);
                    setOpen(false);
                  }}
                >
                  <OrbModuleSwatch module={module} theme={theme} />
                  <span className="cyber-select-option-name">{module.name}</span>
                  {selected ? <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      ) : null}
    </div>
  );
}

// The numeric "Liquid glass" sliders, in display order. `enabled` is handled
// separately as the group's master switch.
type GlassSliderKey =
  | "displace"
  | "localStretch"
  | "refractPower"
  | "smoothness"
  | "imageBlur"
  | "refractionOpacity"
  | "clarity"
  | "gloss"
  | "reflection"
  | "drift"
  | "shadow";

// Most knobs are 0-100 magnitudes; a slider may override min/max/step/unit for
// the exceptions (localStretch is signed, imageBlur is a direct 0-10px value).
const GLASS_SLIDERS: {
  key: GlassSliderKey;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}[] = [
  { key: "displace", label: "Refraction", description: "How hard the glass bends the page behind the whole orb" },
  { key: "localStretch", label: "Background size", description: "Size of the background sampled through the glass: negative shrinks, positive enlarges (up to 4×)", min: -100, max: 300 },
  { key: "refractPower", label: "Refraction curve", description: "Curvature of the glass dome — low is a near-flat pane, high piles refraction into a thick fisheye rim" },
  { key: "smoothness", label: "Melt", description: "Liquid softening of the refraction" },
  { key: "imageBlur", label: "Blur", description: "Frosted-glass blur of the refracted image seen through the orb", min: 0, max: 10, step: 0.5, unit: "px" },
  { key: "refractionOpacity", label: "Refraction opacity", description: "Opacity of the whole refraction: 100 is full glass, 0 shows the plain page through the orb" },
  { key: "clarity", label: "Clarity", description: "How clear the orb centre goes so the refraction reads through" },
  { key: "gloss", label: "Gloss", description: "Key-light highlight fading in from the top edge" },
  { key: "reflection", label: "Reflection", description: "Silver-room reflection fading in from the rim" },
  { key: "drift", label: "Drift", description: "How far the reflection flows as the orb moves" },
  { key: "shadow", label: "Shadow", description: "Depth of the shadow the orb casts" },
];

function readSlot(theme: NovaAvatarTheme, slot: AvatarSlot): ThemeColorValue {
  if (slot === "gradientAlert") return theme.gradientAlert;
  if (slot === "gradientCenter") return theme.gradientCenter;
  if (slot === "gradientOuter") return theme.gradientOuter;
  if (slot === "gymNumber") return theme.gymNumberColor;
  if (slot === "voiceGlow") return theme.voiceGlowColor;
  if (slot === "line0") return theme.lineColors[0];
  if (slot === "line1") return theme.lineColors[1];
  return theme.lineColors[2];
}

function lineIndexForSlot(slot: AvatarSlot) {
  if (slot === "line0") return 0;
  if (slot === "line1") return 1;
  if (slot === "line2") return 2;
  return null;
}

function opacityForSlot(theme: NovaAvatarTheme, slot: AvatarSlot) {
  if (slot === "gymNumber") return theme.gymNumberOpacity;
  const index = lineIndexForSlot(slot);
  return index === null ? null : theme.lineOpacities[index];
}

type NovaAvatarConfigProps = {
  embedded?: boolean;
  initialTheme?: Partial<NovaAvatarTheme> | null;
  onThemeChange?: (theme: NovaAvatarTheme) => void;
  onThemePreview?: (theme: NovaAvatarTheme) => void;
  theme?: Partial<NovaAvatarTheme> | null;
};

type NovaAvatarConfigViewProps = {
  embedded: boolean;
  onThemeChange?: (theme: NovaAvatarTheme) => void;
  onThemePreview?: (theme: NovaAvatarTheme) => void;
  theme: NovaAvatarTheme;
};

function NovaAvatarConfigView({
  embedded,
  onThemeChange,
  onThemePreview,
  theme,
}: NovaAvatarConfigViewProps) {
  const { agentName } = useAgentName();
  const setTheme = useCallback((next: NovaAvatarTheme) => {
    const normalized = normalizeNovaAvatarTheme(next);
    onThemeChange?.(normalized);
  }, [onThemeChange]);
  const previewTheme = useCallback((next: NovaAvatarTheme) => {
    onThemePreview?.(normalizeNovaAvatarTheme(next));
  }, [onThemePreview]);
  const [activeSlot, setActiveSlot] = useState<AvatarSlot | null>(null);

  // The active module's declared sliders ("Module options"). Values come from
  // the theme's per-module overrides with declared defaults filled in, so the
  // sliders always sit somewhere meaningful.
  const activeModule = useOrbModule(theme.orbModule);
  const moduleSettingValues = resolveOrbModuleSettings(
    activeModule,
    theme.orbModuleSettings[activeModule.id],
  );
  const moduleSettingTheme = useCallback(
    (settingId: string, value: number) => {
      return {
        ...theme,
        orbModuleSettings: {
          ...theme.orbModuleSettings,
          [activeModule.id]: {
            ...theme.orbModuleSettings[activeModule.id],
            [settingId]: value,
          },
        },
      };
    },
    [activeModule.id, theme],
  );

  // "Liquid glass" overlay knobs live on the theme (they apply over any orb
  // module), so they update the theme's `glass` block directly.
  const glassNumberTheme = useCallback(
    (key: GlassSliderKey, value: number) => ({
      ...theme,
      glass: { ...theme.glass, [key]: value },
    }),
    [theme],
  );

  const slotTheme = useCallback(
    (slot: AvatarSlot, value: ThemeColorValue) => {
      if (slot === "gradientCenter") {
        return { ...theme, gradientCenter: value };
      }
      if (slot === "gradientOuter") {
        return { ...theme, gradientOuter: value };
      }
      if (slot === "gradientAlert") {
        return { ...theme, gradientAlert: value };
      }
      if (slot === "gymNumber") {
        return { ...theme, gymNumberColor: value };
      }
      if (slot === "voiceGlow") {
        return { ...theme, voiceGlowColor: value };
      }

      const index = slot === "line0" ? 0 : slot === "line1" ? 1 : 2;
      const nextLines: NovaAvatarTheme["lineColors"] = [
        theme.lineColors[0],
        theme.lineColors[1],
        theme.lineColors[2],
      ];
      nextLines[index] = value;
      return { ...theme, lineColors: nextLines };
    },
    [theme],
  );

  const opacityTheme = useCallback(
    (slot: AvatarSlot, opacity: number) => {
      if (slot === "gymNumber") {
        return { ...theme, gymNumberOpacity: opacity };
      }

      const index = lineIndexForSlot(slot);
      if (index === null) return theme;

      const nextOpacities: NovaAvatarTheme["lineOpacities"] = [
        theme.lineOpacities[0],
        theme.lineOpacities[1],
        theme.lineOpacities[2],
      ];
      nextOpacities[index] = opacity;
      return { ...theme, lineOpacities: nextOpacities };
    },
    [theme],
  );
  const selectSlot = useCallback((slot: AvatarSlot) => {
    setActiveSlot((current) => (current === slot ? null : slot));
  }, []);

  const renderWidget = (choice: AvatarSlotChoice) => {
    const value = readSlot(theme, choice.slot);
    const rgb = appliedThemeRgb(value);
    const active = activeSlot === choice.slot;
    const opacity = opacityForSlot(theme, choice.slot);

    return (
      <ColorWidget
        key={choice.slot}
        active={active}
        detail={choice.detail}
        label={choice.label}
        rgb={rgb}
        swatchOpacity={opacity === null ? undefined : Math.max(0.18, opacity / 100)}
        onToggle={() => selectSlot(choice.slot)}
      >
        <ColorSpectrum
          label={choice.label}
          value={value}
          onPreview={(next) => {
            previewTheme(slotTheme(choice.slot, next));
          }}
          onCommit={(next) => setTheme(slotTheme(choice.slot, next))}
        />
        <ColorIntensitySlider
          label={choice.label}
          value={value}
          onPreview={(next) => previewTheme(slotTheme(choice.slot, next))}
          onCommit={(next) => setTheme(slotTheme(choice.slot, next))}
        />
        {opacity !== null ? (
          <NovaOpacity
            color={value}
            label={choice.label}
            value={opacity}
            onPreview={(next) => previewTheme(opacityTheme(choice.slot, next))}
            onCommit={(next) => setTheme(opacityTheme(choice.slot, next))}
          />
        ) : null}
      </ColorWidget>
    );
  };

  const content = (
    <section className="nova-avatar-cfg">
      <OrbModuleSelect
        theme={theme}
        value={theme.orbModule}
        onChange={(id) => setTheme({ ...theme, orbModule: id })}
      />
      <div className="nova-avatar-cfg-preview-wrap">
        <NovaAvatar
          size={150}
          forceVisible
          forceGymAlert
          themeOverride={theme}
          className="nova-avatar-cfg-preview-host"
        />
      </div>
      <header className="nova-avatar-cfg-header">
        <h2 className="nova-avatar-cfg-title">{agentName}</h2>
        <p className="nova-avatar-cfg-subtitle">Responsive host activity widget</p>
      </header>

      {activeModule.settings && activeModule.settings.length > 0 ? (
        <div className="nova-avatar-cfg-group">
          <h3 className="nova-avatar-cfg-group-title">{activeModule.name} options</h3>
          <div className="grid gap-3">
            {activeModule.settings.map((decl) => {
              const value = moduleSettingValues[decl.id];
              return (
                <SliderControlPanel
                  key={decl.id}
                  ariaLabel={decl.description ? `${decl.label} — ${decl.description}` : `${activeModule.name} ${decl.label}`}
                  ariaValueText={`${value}`}
                  color={appliedThemeRgb(theme.gradientOuter)}
                  intensity={100}
                  label={decl.label}
                  max={decl.max}
                  min={decl.min}
                  step={decl.step}
                  value={value}
                  valueText={`${value}`}
                  onPreview={(next) => previewTheme(moduleSettingTheme(decl.id, next))}
                  onCommit={(next) => setTheme(moduleSettingTheme(decl.id, next))}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Liquid glass</h3>
        <div className="grid gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={theme.glass.enabled}
            aria-label={`Turn the liquid glass overlay ${theme.glass.enabled ? "off" : "on"}`}
            className={`cyber-checkbox-row border p-4 text-left ${theme.glass.enabled ? "cyber-checkbox-row-active" : ""}`}
            onClick={() => setTheme({ ...theme, glass: { ...theme.glass, enabled: !theme.glass.enabled } })}
          >
            <span
              className={`cyber-checkbox ${theme.glass.enabled ? "cyber-checkbox-checked" : ""}`}
              aria-hidden="true"
            >
              {theme.glass.enabled ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
            </span>
            <span className="grid min-w-0 gap-1">
              <span className="theme-display-label zone-title-bar">Glass overlay</span>
              <span className="theme-display-detail">
                {theme.glass.enabled
                  ? "On: refraction, silver-room reflection, gloss and cast shadow"
                  : "Off: flat orb, no glass treatment"}
              </span>
            </span>
          </button>
        </div>
        {theme.glass.enabled ? (
          <div className="grid gap-3">
            {GLASS_SLIDERS.map((slider) => {
              const value = theme.glass[slider.key];
              const valueLabel = `${value}${slider.unit ?? ""}`;
              return (
                <SliderControlPanel
                  key={slider.key}
                  ariaLabel={`${slider.label} — ${slider.description}`}
                  ariaValueText={valueLabel}
                  color={appliedThemeRgb(theme.gradientOuter)}
                  intensity={100}
                  label={slider.label}
                  max={slider.max ?? 100}
                  min={slider.min ?? 0}
                  step={slider.step ?? 1}
                  value={value}
                  valueText={valueLabel}
                  onPreview={(next) => previewTheme(glassNumberTheme(slider.key, next))}
                  onCommit={(next) => setTheme(glassNumberTheme(slider.key, next))}
                />
              );
            })}
            <button
              type="button"
              role="switch"
              aria-checked={theme.glass.flipVertical}
              aria-label="Flip the refracted image vertically"
              className={`cyber-checkbox-row border p-4 text-left ${theme.glass.flipVertical ? "cyber-checkbox-row-active" : ""}`}
              onClick={() => setTheme({ ...theme, glass: { ...theme.glass, flipVertical: !theme.glass.flipVertical } })}
            >
              <span
                className={`cyber-checkbox ${theme.glass.flipVertical ? "cyber-checkbox-checked" : ""}`}
                aria-hidden="true"
              >
                {theme.glass.flipVertical ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
              </span>
              <span className="grid min-w-0 gap-1">
                <span className="theme-display-label zone-title-bar">Flip vertically</span>
                <span className="theme-display-detail">Reverse the vertical refraction direction for a glass-ball effect</span>
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Background gradient</h3>
        <div className="theme-widget-flow">
          {AVATAR_SLOTS.slice(0, 2).map(renderWidget)}
        </div>
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Line colors</h3>
        <div className="theme-widget-flow">
          {AVATAR_SLOTS.slice(5).map(renderWidget)}
        </div>
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Status Orb Info</h3>
        <div className="theme-widget-flow">
          {AVATAR_SLOTS.slice(2, 5).map(renderWidget)}
        </div>
      </div>
    </section>
  );

  if (embedded) {
    return content;
  }

  return (
    <ConfigAccordion title="Status Orb" icon={<CircleDot className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      {content}
    </ConfigAccordion>
  );
}

function LegacyStandaloneNovaAvatarConfig({ initialTheme }: Pick<NovaAvatarConfigProps, "initialTheme">) {
  const shared = useLegacyNovaAvatarTheme(initialTheme);
  return (
    <NovaAvatarConfigView
      embedded={false}
      theme={shared.theme}
      onThemeChange={shared.setTheme}
      onThemePreview={shared.previewTheme}
    />
  );
}

export function NovaAvatarConfig({
  embedded = false,
  initialTheme,
  onThemeChange,
  onThemePreview,
  theme: controlledTheme,
}: NovaAvatarConfigProps) {
  if (!embedded && controlledTheme === undefined && onThemeChange === undefined) {
    return <LegacyStandaloneNovaAvatarConfig initialTheme={initialTheme} />;
  }

  return (
    <NovaAvatarConfigView
      embedded={embedded}
      theme={normalizeNovaAvatarTheme(controlledTheme ?? initialTheme ?? DEFAULT_NOVA_AVATAR_THEME)}
      onThemeChange={onThemeChange}
      onThemePreview={onThemePreview}
    />
  );
}

export { DEFAULT_NOVA_AVATAR_THEME };
