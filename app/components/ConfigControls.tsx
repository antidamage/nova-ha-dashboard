"use client";

import { ChevronRight, Clipboard, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  appliedThemeRgb,
  themeRgbAtPosition,
  type ThemeColorValue,
} from "./accentColor";
import { configAccordionKey, getAccordionOpen, setAccordionOpen } from "./configUiState";
import { ConfigColorPicker } from "./ConfigColorPicker";
import { DotLineControl } from "./DotControls";
import { ModalOverlay } from "./ModalOverlay";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

type DotLineMarker = { active?: boolean; label: string; value: number };

export function ConfigAccordion({
  actions,
  children,
  className = "",
  defaultOpen = false,
  icon,
  id,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  /** Section icon shown before the title; drawn in the title's text colour. */
  icon?: ReactNode;
  id?: string;
  title: string;
}) {
  const persistKey = configAccordionKey(id ?? title);
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  const toggleOpen = () =>
    setOpen((current) => {
      const next = !current;
      setAccordionOpen(persistKey, next);
      return next;
    });

  // Restore the previously-expanded state when returning to /config within the 5-min
  // window. Runs once and before the hash-target effect below, so a #id deep-link
  // still wins over a remembered collapsed state.
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    const persisted = getAccordionOpen(persistKey);
    if (persisted !== undefined) {
      setOpen(persisted);
    }
  }, [persistKey]);

  // When navigated to with a matching hash (e.g. the update banner links to
  // /config#updates), open this section and scroll it into view.
  useEffect(() => {
    if (!id || typeof window === "undefined") {
      return;
    }
    const focusIfTargeted = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    focusIfTargeted();
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, [id]);

  return (
    <section ref={sectionRef} id={id} className={`config-accordion ${open ? "config-accordion-open" : ""} ${className}`}>
      <div className="config-accordion-header">
        <button
          type="button"
          className="config-accordion-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggleOpen}
        >
          <ChevronRight className="config-accordion-arrow h-5 w-5" aria-hidden="true" />
          {icon}
          <span>{title}</span>
        </button>
        {actions ? <div className="config-accordion-actions">{actions}</div> : null}
      </div>
      {open ? (
        <div id={bodyId} className="config-accordion-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function ColorSpectrum({
  label,
  onCommit,
  onPreview,
  value,
}: {
  label: string;
  onCommit: (value: ThemeColorValue) => void;
  onPreview: (value: ThemeColorValue) => void;
  value: ThemeColorValue;
}) {
  const displayRgb = appliedThemeRgb(value);

  return (
    <div>
      <ConfigColorPicker
        ariaLabel={`${label} color spectrum`}
        cursor={value.cursor}
        demoTooltipTitle={`${label} Spectrum`}
        demoTooltip="Drag to tune this theme colour."
        rgbAtPosition={themeRgbAtPosition}
        onChange={(cursor, rgb) => onPreview({ ...value, cursor, rgb })}
        onCommit={(cursor, rgb) => onCommit({ ...value, cursor, rgb })}
      />
      <div className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-300">
        <span className="uppercase text-fuchsia-200">{label}</span>
        <span className="tabular-nums text-neutral-400">rgb {displayRgb.join(" ")}</span>
      </div>
    </div>
  );
}

export function SliderControlPanel({
  activeColor,
  ariaLabel,
  ariaValueText,
  color,
  dotOpacity,
  fill = true,
  intensity,
  label,
  markers,
  max,
  min,
  onCommit,
  onPreview,
  snapTolerance,
  snapValue,
  step,
  value,
  valueText,
}: {
  activeColor?: [number, number, number];
  ariaLabel: string;
  ariaValueText: string;
  color: [number, number, number];
  dotOpacity?: number;
  /** Tinted accent back-fill up to the thumb. Config sliders are magnitudes, so
   *  this defaults on; pass `false` for stepped/choice controls. */
  fill?: boolean;
  intensity?: number;
  label: string;
  markers?: DotLineMarker[];
  max: number;
  min: number;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
  /** Magnetic zone around `snapValue`, in value units. */
  snapTolerance?: number;
  /** A fixed value (e.g. the default) the slider snaps to on drag. */
  snapValue?: number;
  step: number;
  value: number;
  valueText: ReactNode;
}) {
  // Config contract: onPreview is local UI state only; onCommit is the single
  // persistence boundary fired by DotLineControl on pointer/key release. Keeping
  // both required makes save-on-drag wiring a compile-time error at every use.
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_112px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel={ariaLabel}
            ariaValueText={ariaValueText}
            value={value}
            min={min}
            max={max}
            step={step}
            color={color}
            activeColor={activeColor}
            demoTooltipTitle={label}
            demoTooltip="Drag to adjust this setting."
            dotOpacity={dotOpacity}
            fill={fill}
            intensity={intensity}
            markers={markers}
            snapTolerance={snapTolerance}
            snapValue={snapValue}
            onChange={onPreview}
            onCommit={onCommit}
          />
        </div>
        <p className="config-slider-value text-3xl font-black tabular-nums text-neutral-50 md:text-right">
          {valueText}
        </p>
      </div>
    </div>
  );
}

export function ColorIntensitySlider({
  label,
  onCommit,
  onPreview,
  value,
}: {
  label: string;
  onCommit: (value: ThemeColorValue) => void;
  onPreview: (value: ThemeColorValue) => void;
  value: ThemeColorValue;
}) {
  return (
    <SliderControlPanel
      ariaLabel={`${label} intensity`}
      ariaValueText={`${value.intensity}%`}
      color={value.rgb}
      intensity={value.intensity}
      label="Intensity"
      max={100}
      min={0}
      step={1}
      value={value.intensity}
      valueText={`${value.intensity}%`}
      onPreview={(intensity) => onPreview({ ...value, intensity })}
      onCommit={(intensity) => onCommit({ ...value, intensity })}
    />
  );
}

export function ColorWidget({
  active,
  children,
  detail,
  label,
  onCopyColor,
  onPasteColor,
  onToggle,
  pasteColorDisabled,
  rgb,
  swatchOpacity,
}: {
  active: boolean;
  children: ReactNode;
  detail: string;
  label: string;
  onCopyColor?: () => void;
  onPasteColor?: () => void;
  onToggle: () => void;
  pasteColorDisabled?: boolean;
  rgb: [number, number, number];
  swatchOpacity?: number;
}) {
  return (
    <div className={`theme-widget-cell ${active ? "theme-widget-cell-active" : ""}`}>
      <button
        type="button"
        aria-expanded={active}
        aria-haspopup="dialog"
        className={`theme-display-card border p-4 text-left ${active ? "theme-display-card-active" : ""}`}
        onClick={onToggle}
      >
        <span
          className="theme-display-swatch border"
          style={{
            backgroundColor: `rgb(${rgb.join(",")})`,
            opacity: swatchOpacity,
          }}
        />
        <span className="theme-display-copy">
          <span className="theme-display-label zone-title-bar">{label}</span>
          <span className="theme-display-detail">{detail}</span>
        </span>
      </button>

      <ModalOverlay
        open={active}
        onClose={onToggle}
        ariaLabel={`${label} colour picker`}
        className="theme-colour-popover"
      >
            <header className="theme-colour-popover-header">
              <span className="theme-display-label zone-title-bar">{label}</span>
              <button type="button" className="theme-colour-popover-close" aria-label={`Close ${label} colour picker`} onClick={onToggle}>
                Close
              </button>
            </header>
            <div className="theme-inline-editor grid gap-4 border border-cyan-300/30 bg-neutral-900/80 p-4">
            {onCopyColor || onPasteColor ? (
              <div className="theme-widget-actions">
                {onCopyColor ? (
                  <MomentaryFeedbackButton
                    type="button"
                    className="theme-widget-action"
                    aria-label={`Copy ${label} colour`}
                    data-demo-tooltip-title="Copy Colour"
                    data-demo-tooltip="Copy this colour, intensity and opacity."
                    onClick={onCopyColor}
                  >
                    <Copy className="h-4 w-4" />
                  </MomentaryFeedbackButton>
                ) : null}
                {onPasteColor ? (
                  <MomentaryFeedbackButton
                    type="button"
                    className="theme-widget-action"
                    aria-label={`Paste colour into ${label}`}
                    disabled={pasteColorDisabled}
                    data-demo-tooltip-title="Paste Colour"
                    data-demo-tooltip="Paste the copied colour into this widget."
                    onClick={onPasteColor}
                  >
                    <Clipboard className="h-4 w-4" />
                  </MomentaryFeedbackButton>
                ) : null}
              </div>
            ) : null}
            <div className="config-color-editor">{children}</div>
            </div>
      </ModalOverlay>
    </div>
  );
}
