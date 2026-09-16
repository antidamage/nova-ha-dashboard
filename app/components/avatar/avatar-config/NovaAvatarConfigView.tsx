"use client";

import { CircleDot } from "lucide-react";
import { useRef } from "react";
import { appliedThemeRgb } from "../../accentColor";
import {
  ColorEncoderPanel,
  ColorWidget,
  ConfigAccordion,
  SliderControlPanel,
} from "../../ConfigControls";
import { useAgentName } from "../../AgentNameContext";
import { copyColorToClipboard, useThemeClipboard } from "../../themeClipboard";
import { SwitchRow } from "../../SlideSwitch";
import { AVATAR_SLOTS, GLASS_SLIDERS } from "./constants";
import { OrbModuleSelect } from "./OrbModuleSelect";
import { PinnedOrbPreview } from "./PinnedOrbPreview";
import { alertPulseRateText, opacityForSlot, readSlot } from "./slot-model";
import type { AvatarSlotChoice, NovaAvatarConfigViewProps } from "./types";
import { useAvatarThemeEdits } from "./useAvatarThemeEdits";

export function NovaAvatarConfigView({
  embedded,
  onThemeChange,
  onThemePreview,
  theme,
}: NovaAvatarConfigViewProps) {
  const { agentName } = useAgentName();
  const sectionRef = useRef<HTMLElement | null>(null);
  const {
    setTheme,
    previewTheme,
    activeModule,
    moduleSettingValues,
    moduleSettingTheme,
    glassNumberTheme,
    colorAndOpacityTheme,
  } = useAvatarThemeEdits({ onThemeChange, onThemePreview, theme });
  // Shares the theme editor's colour clipboard, so a theme colour can be
  // pasted into an orb slot and back (specs/color-encoder.md).
  const clipboard = useThemeClipboard();
  const renderWidget = (choice: AvatarSlotChoice) => {
    const value = readSlot(theme, choice.slot);
    const opacity = opacityForSlot(theme, choice.slot);
    const pasteColor = () => {
      const clip = clipboard.color;
      if (!clip) return;
      const nextOpacity = opacity === null
        ? null
        : clip.opacity === undefined ? opacity : Math.max(0, Math.min(100, Math.round(clip.opacity)));
      setTheme(colorAndOpacityTheme(choice.slot, clip.value, nextOpacity));
    };

    return (
      <ColorWidget
        key={choice.slot}
        label={choice.label}
        onCopyColor={() => copyColorToClipboard({ value, opacity: opacity === null ? undefined : opacity })}
        onPasteColor={pasteColor}
        pasteColorDisabled={!clipboard.color}
      >
        <ColorEncoderPanel
          label={choice.label}
          value={value}
          opacity={opacity === null ? undefined : opacity}
          onPreview={(next, nextOpacity) => previewTheme(colorAndOpacityTheme(choice.slot, next, opacity === null ? null : nextOpacity))}
          onCommit={(next, nextOpacity) => setTheme(colorAndOpacityTheme(choice.slot, next, opacity === null ? null : nextOpacity))}
        />
      </ColorWidget>
    );
  };

  const content = (
    <section ref={sectionRef} className="nova-avatar-cfg">
      <OrbModuleSelect
        theme={theme}
        value={theme.orbModule}
        onChange={(id) => setTheme({ ...theme, orbModule: id })}
      />
      <PinnedOrbPreview sectionRef={sectionRef} theme={theme} />
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
              // A setting declared as a single step from 0 to 1 is a choice,
              // not a magnitude — give it the checkbox it actually is rather
              // than a two-position slider.
              if (decl.min === 0 && decl.max === 1 && decl.step === 1) {
                return (
                  <SwitchRow
                    key={decl.id}
                    checked={value >= 1}
                    detail={decl.description}
                    label={decl.label}
                    onChange={(checked) => setTheme(moduleSettingTheme(decl.id, checked ? 1 : 0))}
                  />
                );
              }
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
        <h3 className="nova-avatar-cfg-group-title">Alert pulse</h3>
        <div className="grid gap-3">
          <SliderControlPanel
            ariaLabel="Alert pulse rate — how fast the orb beats while an alert is up"
            ariaValueText={alertPulseRateText(theme.alertPulseRate)}
            color={appliedThemeRgb(theme.gradientAlert)}
            intensity={100}
            label="Rate"
            max={100}
            min={0}
            step={1}
            value={theme.alertPulseRate}
            valueText={alertPulseRateText(theme.alertPulseRate)}
            onPreview={(next) => previewTheme({ ...theme, alertPulseRate: next })}
            onCommit={(next) => setTheme({ ...theme, alertPulseRate: next })}
          />
        </div>
      </div>

      <div className="nova-avatar-cfg-group">
        <h3 className="nova-avatar-cfg-group-title">Liquid glass</h3>
        <div className="grid gap-1.5">
          <SwitchRow
            checked={theme.glass.enabled}
            label="Glass overlay"
            detail={
              theme.glass.enabled
                ? "On: refraction, silver-room reflection, gloss and cast shadow"
                : "Off: flat orb, no glass treatment"
            }
            onChange={(enabled) => setTheme({ ...theme, glass: { ...theme.glass, enabled } })}
          />
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
            <SwitchRow
              checked={theme.glass.flipVertical}
              label="Flip vertically"
              detail="Reverse the vertical refraction direction for a glass-ball effect"
              onChange={(flipVertical) => setTheme({ ...theme, glass: { ...theme.glass, flipVertical } })}
            />
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
    <ConfigAccordion id="nova-avatar-standalone" title="Status Orb" icon={<CircleDot className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      {content}
    </ConfigAccordion>
  );
}
