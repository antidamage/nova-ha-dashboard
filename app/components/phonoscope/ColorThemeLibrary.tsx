"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PhonoscopeColorTheme, PhonoscopeColorValue } from "../../../lib/types";
import {
  ColorIntensitySlider,
  ColorSpectrum,
  ColorWidget,
  ConfigAccordion,
  SliderControlPanel,
} from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CentreImageLibrary } from "./CentreImageLibrary";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { SoloButton } from "./SoloControls";
import { reidColorTheme } from "./clipboard";
import { useEditLock } from "./editing-lock";

export type PaletteSlot = { id: string; label: string; defaultRgb: [number, number, number] };

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultColor(slot: PaletteSlot): PhonoscopeColorValue {
  return { rgb: slot.defaultRgb, intensity: 100, opacity: 100, cursor: { x: 0.5, y: 0.5 } };
}

/** A theme's swatch: background, dot and glow, which is what reads at a glance. */
export function themeGradient(colors: Record<string, PhonoscopeColorValue>) {
  const rgb = (ids: string[], fallback: string) => {
    const value = ids.map((id) => colors[id]).find(Boolean);
    if (!value) return fallback;
    const scale = (Number.isFinite(value.intensity) ? value.intensity : 100) / 100;
    const opacity = (Number.isFinite(value.opacity) ? value.opacity : 100) / 100;
    return `rgb(${value.rgb.map((part) => Math.round(part * scale)).join(" ")} / ${opacity})`;
  };
  return `linear-gradient(135deg, ${rgb(["backgroundPrimary", "background"], "#000")} 0 33.333%, `
    + `${rgb(["dotPrimary", "primary"], "#777")} 33.333% 66.666%, `
    + `${rgb(["glowPrimary", "secondary"], "#ddd")} 66.666%)`;
}

/**
 * The flat colour theme library. Themes are colour only — behaviour comes from
 * whichever settings groups a colour group entry names alongside them, so the
 * same palette can run under several different sets of drivers.
 */
export function ColorThemeLibrary({
  moduleId,
  onChange,
  onSolo,
  paletteSlots,
  soloId,
  themes,
}: {
  moduleId: string;
  onChange: (themes: PhonoscopeColorTheme[], commit?: boolean) => void;
  paletteSlots: PaletteSlot[];
  themes: PhonoscopeColorTheme[];
  /** The soloed colour theme, or "" when nothing is held. */
  soloId: string;
  onSolo: (themeId: string) => void;
}) {
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  // One lock for the whole library: only one name can have focus at a time, and
  // moving between two of them blurs the first before focusing the second.
  const editLock = useEditLock();

  const updateTheme = (id: string, patch: Partial<PhonoscopeColorTheme>, commit = false) =>
    onChange(themes.map((theme) => theme.id === id ? { ...theme, ...patch } : theme), commit);

  return (
    <ConfigAccordion
      id="phonoscope-color-themes"
      title="Colour themes"
      className="border border-neutral-800 bg-neutral-950/30"
    >
      <div className="grid gap-3 p-3">
        {themes.map((theme) => (
          <ConfigAccordion
            key={theme.id}
            id={`color-theme-${theme.id}`}
            title={theme.name}
            className="border border-neutral-800 bg-neutral-950/45"
            actions={
              <span className="flex items-center gap-2">
                <span
                  className="cyber-select-swatch"
                  aria-hidden="true"
                  style={{ background: themeGradient(theme.colors) }}
                />
                <SoloButton
                  active={soloId === theme.id}
                  label={theme.name}
                  onToggle={() => onSolo(soloId === theme.id ? "" : theme.id)}
                />
                <CopyActions
                  kind="colorTheme"
                  label={theme.name}
                  payload={theme}
                  onDuplicate={() => onChange([...themes, {
                    ...reidColorTheme(theme),
                    name: `${theme.name} copy`,
                  }], true)}
                />
                <MomentaryFeedbackButton
                  type="button" className="icon-link text-red-200" aria-label={`Delete ${theme.name}`}
                  onClick={() => onChange(themes.filter((entry) => entry.id !== theme.id), true)}
                >
                  <Trash2 className="h-4 w-4" />
                </MomentaryFeedbackButton>
              </span>
            }
          >
            <div className="grid gap-3 p-3">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-black uppercase text-neutral-400">Name</span>
                <input
                  className="cyber-text-input"
                  value={theme.name}
                  onChange={(event) => updateTheme(theme.id, { name: event.target.value })}
                  onFocus={editLock.onFocus}
                  onBlur={() => {
                    editLock.onBlur();
                    onChange(themes, true);
                  }}
                />
              </label>
              {/*
                `theme-widget-flow` is the dashboard theme editor's own wrapping
                row for colour widgets. The previous class did not exist, so the
                grid fell back to one column and listed every slot down the page.
              */}
              <div className="theme-widget-flow">
                {paletteSlots.map((slot) => {
                  const value = theme.colors[slot.id] ?? defaultColor(slot);
                  const slotKey = `${theme.id}:${slot.id}`;
                  return (
                    <ColorWidget
                      key={slot.id}
                      active={activeSlot === slotKey}
                      detail={`rgb ${value.rgb.map(Math.round).join(" ")}`}
                      label={slot.label}
                      rgb={value.rgb}
                      intensity={value.intensity}
                      swatchOpacity={value.opacity / 100}
                      onToggle={() => setActiveSlot(activeSlot === slotKey ? null : slotKey)}
                    >
                      <ColorSpectrum
                        label={slot.label}
                        // `ColorSpectrum` works in the dashboard's own colour
                        // shape, which requires a cursor. A Phonoscope colour
                        // carries one optionally, so it is defaulted to centre.
                        value={{
                          rgb: value.rgb,
                          intensity: value.intensity,
                          cursor: value.cursor ?? { x: 0.5, y: 0.5 },
                        }}
                        onPreview={(color) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...color, opacity: value.opacity } },
                        })}
                        onCommit={(color) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...color, opacity: value.opacity } },
                        }, true)}
                      />
                      {/*
                        Intensity is a separate control from the spectrum, the
                        same way it is in the dashboard theme editor: the
                        spectrum picks the hue, this picks how hard it is
                        driven. The cursor is defaulted to centre here for the
                        same reason as above — a Phonoscope colour carries one
                        only optionally, and dropping it would move the
                        spectrum's crosshair every time intensity changed.
                      */}
                      <ColorIntensitySlider
                        label={slot.label}
                        value={{
                          rgb: value.rgb,
                          intensity: value.intensity,
                          cursor: value.cursor ?? { x: 0.5, y: 0.5 },
                        }}
                        onPreview={(color) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...color, opacity: value.opacity } },
                        })}
                        onCommit={(color) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...color, opacity: value.opacity } },
                        }, true)}
                      />
                      <SliderControlPanel
                        ariaLabel={`${slot.label} opacity`}
                        ariaValueText={`${Math.round(value.opacity)}%`}
                        color={value.rgb}
                        dotOpacity={value.opacity / 100}
                        intensity={value.intensity}
                        label="Opacity"
                        min={0}
                        max={100}
                        step={1}
                        value={value.opacity}
                        valueText={`${Math.round(value.opacity)}%`}
                        onPreview={(opacity) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...value, opacity } },
                        })}
                        onCommit={(opacity) => updateTheme(theme.id, {
                          colors: { ...theme.colors, [slot.id]: { ...value, opacity } },
                        }, true)}
                      />
                    </ColorWidget>
                  );
                })}
              </div>

              <label className="grid gap-2 text-sm">
                <span className="font-black uppercase text-neutral-200">Centre image</span>
                <CentreImageLibrary
                  emptyLabel="None"
                  slot="centre"
                  selectedId={theme.imageId ?? null}
                  onSelect={(imageId) => updateTheme(theme.id, { imageId }, true)}
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-black uppercase text-neutral-200">Background image</span>
                <CentreImageLibrary
                  emptyLabel="None"
                  slot="background"
                  selectedId={theme.backgroundImageId ?? null}
                  onSelect={(backgroundImageId) =>
                    updateTheme(theme.id, { backgroundImageId }, true)}
                />
              </label>

              <PasteIntoButton
                kind="colorTheme"
                what="colour theme"
                // The theme keeps its name, id and both images; only its
                // palette is replaced — an image is a picture element rather
                // than part of the colours being copied.
                onPaste={(pasted) => updateTheme(theme.id, { colors: pasted.colors }, true)}
              />
            </div>
          </ConfigAccordion>
        ))}
        <MomentaryFeedbackButton
          type="button"
          className="config-page-button justify-center"
          onClick={() => onChange([...themes, {
            id: newId("theme"),
            name: `Colour theme ${themes.length + 1}`,
            moduleId,
            colors: Object.fromEntries(paletteSlots.map((slot) => [slot.id, defaultColor(slot)])),
            imageId: null,
            backgroundImageId: null,
          }], true)}
        >
          <Plus className="h-5 w-5" />
          Add colour theme
        </MomentaryFeedbackButton>

      </div>
    </ConfigAccordion>
  );
}
