"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  THEME_FONT_SIZE_OFFSET_MAX,
  THEME_FONT_SIZE_OFFSET_MIN,
  THEME_FONT_WEIGHT_MAX,
  THEME_FONT_WEIGHT_MIN,
  THEME_FONT_WEIGHT_STEP,
  themeFontSizeScale,
  type ThemeFontSetting,
} from "./accentColor";
import { SliderControlPanel } from "./ConfigControls";
import { getThemeFont, THEME_FONT_OPTIONS } from "./themeFonts";

type Rgb = [number, number, number];

// Dropdown for picking a theme/clock font. Previews each option rendered in its own
// font (`preview` = the glyph sample in the swatch, "Aa"/"12"). The list is sorted
// alphabetically by label with the currently-selected font floated to the top. The
// open menu is rendered in a portal to <body> with fixed positioning so it escapes
// the config accordion's `overflow: hidden` + `clip-path`, which otherwise clip the
// long font list — it always paints in front of everything.
export function FontSelect({
  label,
  onChange,
  preview,
  value,
}: {
  label: string;
  onChange: (id: string) => void;
  preview: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const selectedOptionRef = useRef<HTMLLIElement | null>(null);
  const listboxId = useId();
  const active = getThemeFont(value) ?? THEME_FONT_OPTIONS[0];

  // Strictly alphabetical by label.
  const options = useMemo(
    () => [...THEME_FONT_OPTIONS].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setMenuRect({ left: rect.left, top: rect.bottom + 6, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    reposition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    // Keep the portalled menu glued to the trigger if anything scrolls/resizes.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Center the in-use font in the menu viewport once per open. Deferred to the next
  // frame so the portalled menu has been laid out; not tied to menuRect, which churns
  // on every scroll/resize and would otherwise re-center mid-scroll.
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      selectedOptionRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="font-select-field">
      <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
      <div className="theme-library-select" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`cyber-select-trigger ${open ? "cyber-select-trigger-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="cyber-select-swatch font-select-swatch" aria-hidden="true" style={{ fontFamily: active.stack }}>
            {preview}
          </span>
          <span className="cyber-select-trigger-copy">
            <span className="cyber-select-trigger-name font-select-name" style={{ fontFamily: active.stack }}>{active.label}</span>
            <span className="cyber-select-trigger-detail">{active.kind}</span>
          </span>
          <ChevronDown className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`} aria-hidden="true" />
        </button>

        {open && menuRect
          ? createPortal(
              <ul
                ref={menuRef}
                className="cyber-select-menu cyber-select-menu-portal"
                id={listboxId}
                role="listbox"
                aria-label={label}
                style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
              >
                {options.map((option) => {
                  const selected = option.id === active.id;
                  return (
                    <li
                      key={option.id}
                      ref={selected ? selectedOptionRef : undefined}
                      role="option"
                      aria-selected={selected}
                    >
                      <button
                        type="button"
                        className={`cyber-select-option ${selected ? "cyber-select-option-active" : ""}`}
                        onClick={() => {
                          onChange(option.id);
                          setOpen(false);
                        }}
                      >
                        <span className="cyber-select-swatch font-select-swatch" aria-hidden="true" style={{ fontFamily: option.stack }}>
                          {preview}
                        </span>
                        <span className="cyber-select-option-name font-select-name" style={{ fontFamily: option.stack }}>{option.label}</span>
                        {selected ? <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}

function formatOffset(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

// Reusable font control: a font picker plus a weight slider and a size-offset slider
// (weight above size, per the design). Emits a full ThemeFontSetting. Reused for the
// theme font, clock font, gym readout font, and future font slots.
export function FontControl({
  label,
  onChange,
  preview,
  sample,
  sliderActiveColor,
  sliderColor,
  value,
}: {
  label: string;
  onChange: (next: ThemeFontSetting) => void;
  preview: string;
  /** Live preview text rendered in the chosen font/weight/size so every slider has a
   *  visible effect even when the real usage (clock, numbers, gym orb) is off-screen. */
  sample?: string;
  sliderActiveColor?: Rgb;
  sliderColor: Rgb;
  value: ThemeFontSetting;
}) {
  const stack = (getThemeFont(value.id) ?? THEME_FONT_OPTIONS[0]).stack;
  const scale = themeFontSizeScale(value.sizeOffset);
  return (
    <div className="font-control grid gap-3">
      <FontSelect label={label} preview={preview} value={value.id} onChange={(id) => onChange({ ...value, id })} />
      <div
        className="font-control-preview"
        aria-hidden="true"
        style={{ fontFamily: stack, fontWeight: value.weight, fontSize: `calc(1.9rem * ${scale})` }}
      >
        {sample ?? "Aa 0123"}
      </div>
      <SliderControlPanel
        activeColor={sliderActiveColor}
        ariaLabel={`${label} weight`}
        ariaValueText={String(value.weight)}
        color={sliderColor}
        fill={false}
        label="Weight"
        markers={[
          { active: value.weight === THEME_FONT_WEIGHT_MIN, label: "Thin", value: THEME_FONT_WEIGHT_MIN },
          { active: value.weight === THEME_FONT_WEIGHT_MAX, label: "Bold", value: THEME_FONT_WEIGHT_MAX },
        ]}
        max={THEME_FONT_WEIGHT_MAX}
        min={THEME_FONT_WEIGHT_MIN}
        step={THEME_FONT_WEIGHT_STEP}
        value={value.weight}
        valueText={String(value.weight)}
        onChange={(weight) => onChange({ ...value, weight: Math.round(weight / THEME_FONT_WEIGHT_STEP) * THEME_FONT_WEIGHT_STEP })}
      />
      <SliderControlPanel
        activeColor={sliderActiveColor}
        ariaLabel={`${label} size offset`}
        ariaValueText={formatOffset(value.sizeOffset)}
        color={sliderColor}
        fill={false}
        label="Size"
        markers={[
          { label: String(THEME_FONT_SIZE_OFFSET_MIN), value: THEME_FONT_SIZE_OFFSET_MIN },
          { active: value.sizeOffset === 0, label: "0", value: 0 },
          { label: `+${THEME_FONT_SIZE_OFFSET_MAX}`, value: THEME_FONT_SIZE_OFFSET_MAX },
        ]}
        max={THEME_FONT_SIZE_OFFSET_MAX}
        min={THEME_FONT_SIZE_OFFSET_MIN}
        step={1}
        value={value.sizeOffset}
        valueText={formatOffset(value.sizeOffset)}
        onChange={(offset) => onChange({ ...value, sizeOffset: Math.round(offset) })}
      />
    </div>
  );
}
