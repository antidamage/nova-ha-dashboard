"use client";

import { Check, ChevronRight, Clipboard, Copy } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  appliedThemeRgb,
  themeRgbAtPosition,
  type ThemeColorValue,
} from "./accentColor";
import { configAccordionKey, getAccordionOpen, setAccordionOpen } from "./configUiState";
import { ConfigColorPicker } from "./ConfigColorPicker";
import { DotEnvelopeControl, DotLineControl, DotRangeControl, type EnvelopeDurations } from "./DotControls";
import { ModalOverlay } from "./ModalOverlay";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

type DotLineMarker = { active?: boolean; label: string; value: number };
const CONFIG_ACCORDION_OPEN_EVENT = "nova-config-accordion-open";

type ConfigAccordionOpenDetail = {
  element: HTMLElement;
  persistKey: string;
};

// The config pages' standard checkbox. Lifted here from AccentConfig once it
// grew a third consumer (AccentConfig's "This Device" block,
// VoiceInputDeviceGroup, RemindersConfig) — it had already been copy-pasted
// once, and a fourth divergent copy is how a checkbox stops looking like a
// checkbox.
export function CheckboxRow({
  checked,
  detail,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  /** Optional: most rows are a label and nothing else. */
  detail?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      className={`cyber-checkbox-row border p-4 text-left ${checked ? "cyber-checkbox-row-active" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true">
        {checked && <Check className="h-6 w-6" strokeWidth={3} />}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="theme-display-label zone-title-bar">{label}</span>
        {detail ? <span className="theme-display-detail">{detail}</span> : null}
      </span>
    </MomentaryFeedbackButton>
  );
}

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

  /**
   * Bring a just-opened section to the top of the viewport.
   *
   * Deferred by two frames rather than run inline: opening also collapses the
   * open sibling, and if that sibling sits above this one the page shrinks
   * underneath us. Measuring before React has committed both changes scrolls to
   * a position that no longer exists by the time it lands. One frame gets the
   * commit, the second gets layout after it.
   *
   * `behavior: "smooth"` is deliberate and deliberately local. Page-level smooth
   * scrolling was removed from this app on purpose (see globals.css) so ordinary
   * navigation lands instantly; this is an explicit exception for a direct
   * manipulation, where the slide is what shows you the page moved rather than
   * jumped. Honours prefers-reduced-motion, for whom an instant jump IS correct.
   */
  const scrollSectionIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const section = sectionRef.current;
        // Guarded: this runs two frames late, so the section may have unmounted,
        // and jsdom (tests) has no scrollIntoView at all. Neither is a reason to
        // throw out of an animation-frame callback, where nothing can catch it.
        if (typeof section?.scrollIntoView !== "function") {
          return;
        }
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    });
  }, []);

  const openExclusively = useCallback(
    (options?: { scrollIntoView?: boolean }) => {
      setOpen(true);
      setAccordionOpen(persistKey, true);
      if (sectionRef.current) {
        window.dispatchEvent(new CustomEvent<ConfigAccordionOpenDetail>(CONFIG_ACCORDION_OPEN_EVENT, {
          detail: { element: sectionRef.current, persistKey },
        }));
      }
      if (options?.scrollIntoView) {
        scrollSectionIntoView();
      }
    },
    [persistKey, scrollSectionIntoView],
  );

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      setAccordionOpen(persistKey, false);
      return;
    }
    // Scrolls only on a real click. The restore-on-return effect below also
    // opens a section, and scrolling there would yank the page on every load.
    openExclusively({ scrollIntoView: true });
  };

  // Accordions with the same nearest accordion ancestor are siblings. Opening
  // one sibling closes the rest, leaving the ancestor chain open.
  useEffect(() => {
    const closeOpenSibling = (event: Event) => {
      const { element, persistKey: openedKey } = (event as CustomEvent<ConfigAccordionOpenDetail>).detail;
      if (openedKey === persistKey || !sectionRef.current) {
        return;
      }
      const ownParent = sectionRef.current.parentElement?.closest(".config-accordion");
      const openedParent = element.parentElement?.closest(".config-accordion");
      if (ownParent === openedParent) {
        setOpen(false);
        setAccordionOpen(persistKey, false);
      }
    };

    window.addEventListener(CONFIG_ACCORDION_OPEN_EVENT, closeOpenSibling);
    return () => window.removeEventListener(CONFIG_ACCORDION_OPEN_EVENT, closeOpenSibling);
  }, [persistKey]);

  // Restore the previously-expanded state when returning to /config within the 5-min
  // window. Runs once and before the hash-target effect below, so a #id deep-link
  // still wins over a remembered collapsed state.
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    const persisted = getAccordionOpen(persistKey);
    if (persisted === true || (persisted === undefined && defaultOpen)) {
      openExclusively();
    } else if (persisted === false) {
      setOpen(false);
    }
  }, [defaultOpen, openExclusively, persistKey]);

  // When navigated to with a matching hash (e.g. the update banner links to
  // /config#updates), open this section and scroll it into view.
  useEffect(() => {
    if (!id || typeof window === "undefined") {
      return;
    }
    const focusIfTargeted = () => {
      if (window.location.hash === `#${id}`) {
        // Same deferred scroll as a click: arriving by hash also collapses the
        // open sibling, so scrolling inline measures a layout about to change.
        openExclusively({ scrollIntoView: true });
      }
    };
    focusIfTargeted();
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, [id, openExclusively]);

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
  snapRemote,
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
  /**
   * Show incoming values immediately instead of easing the thumb toward them.
   *
   * `DotLineControl` eases by default, which is right for a control backed by a
   * device that fades toward what it was told. It is wrong for one backed by
   * stored configuration, where there is no fade for the animation to represent
   * and the travel just reads as the slider moving on its own.
   */
  snapRemote?: boolean;
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
            snapRemote={snapRemote}
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

/**
 * The `RND` tag: a compact checkbox with its three-letter label above it.
 *
 * Deliberately the same visual family as the envelope thumbs' ATK/HLD/REL tags
 * — same 9px uppercase muted type — because it answers the same kind of
 * question about the same kind of control, and it has to stay out of the way of
 * the slider it annotates.
 */
function RandomTargetToggle({
  checked,
  hint,
  onChange,
}: {
  checked: boolean;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer flex-col items-center gap-1 justify-self-center md:justify-self-end"
      title={hint}
    >
      <span className="rect-envelope-tag" aria-hidden="true">RND</span>
      <input
        type="checkbox"
        className="cyber-mini-checkbox-input"
        checked={checked}
        aria-label={hint}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cyber-mini-checkbox" aria-hidden="true">
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </span>
    </label>
  );
}

export function RangeSliderControlPanel({
  ariaLabel,
  formatValue,
  label,
  max,
  min,
  onCommit,
  onPreview,
  onRandomChange,
  random = false,
  step,
  value,
}: {
  ariaLabel: string;
  formatValue: (value: number) => string;
  label: string;
  max: number;
  min: number;
  onCommit: (value: [number, number]) => void;
  onPreview: (value: [number, number]) => void;
  /** Supply to offer the RND tag; omit and the column is not rendered at all. */
  onRandomChange?: (random: boolean) => void;
  random?: boolean;
  step: number;
  value: [number, number];
}) {
  // The readout keeps its width; the tag takes only what it needs, so adding it
  // narrows nothing.
  const columns = onRandomChange
    ? "md:grid-cols-[140px_minmax(0,1fr)_180px_auto]"
    : "md:grid-cols-[140px_minmax(0,1fr)_180px]";
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className={`grid gap-4 ${columns} md:items-center`}>
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotRangeControl
            ariaLabel={ariaLabel}
            ariaValueText={(current) => [formatValue(current[0]), formatValue(current[1])]}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onPreview}
            onCommit={onCommit}
          />
        </div>
        <p className="config-slider-value text-xl font-black tabular-nums text-neutral-50 md:text-right">
          {formatValue(value[0])}–{formatValue(value[1])}
        </p>
        {onRandomChange ? (
          <RandomTargetToggle
            checked={random}
            hint="Pick a random target inside this range each time the lane fires"
            onChange={onRandomChange}
          />
        ) : null}
      </div>
    </div>
  );
}

export function EnvelopeSliderControlPanel({
  ariaLabel,
  label = "Envelope",
  max = 12,
  onCommit,
  onPreview,
  step = 0.05,
  value,
}: {
  ariaLabel: string;
  label?: string;
  max?: number;
  onCommit: (value: EnvelopeDurations) => void;
  onPreview: (value: EnvelopeDurations) => void;
  step?: number;
  value: EnvelopeDurations;
}) {
  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      {/*
        No numeric readout column. The three thumbs already carry their own A/H/R
        labels, so a second copy of the same three values only narrowed the
        control that actually needs the width — and this control is dragged, not
        read off.
      */}
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
        <div className="px-1">
          <DotEnvelopeControl ariaLabel={ariaLabel} max={max} step={step} value={value} onChange={onPreview} onCommit={onCommit} />
        </div>
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
  intensity,
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
  intensity?: number;
  swatchOpacity?: number;
}) {
  const displayedIntensity = Math.max(0, Math.min(100, intensity ?? 100));
  const displayedRgb = rgb.map((component) =>
    Math.round(component * displayedIntensity / 100)) as [number, number, number];
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
            backgroundColor: `rgb(${displayedRgb.join(",")})`,
            opacity: swatchOpacity,
          }}
        />
        <span className="theme-display-copy">
          <span className="theme-display-label zone-title-bar">{label}</span>
          <span className="theme-display-detail">{detail}</span>
          {intensity === undefined ? null : (
            <span className="theme-display-detail">Intensity {Math.round(displayedIntensity)}%</span>
          )}
        </span>
      </button>

      <ModalOverlay
        open={active}
        onClose={onToggle}
        ariaLabel={`${label} colour picker`}
        className="theme-colour-popover"
        overlayClassName="theme-colour-overlay"
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
