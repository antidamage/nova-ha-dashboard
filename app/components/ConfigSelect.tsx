"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { useSelectMenu } from "./useSelectMenu";
import { useModalPortalTarget } from "./ModalOverlay";

export type ConfigSelectOption<T extends string = string> = {
  value: T;
  label: string;
  detail?: string;
  icon?: ReactNode;
  swatch?: ReactNode;
  /**
   * Optional heading this option sits under. Purely opt-in: a list where no
   * option sets it renders exactly as it always has, so existing pickers are
   * untouched. Options are gathered under their heading in first-appearance
   * order, so a caller whose list interleaves groups still gets ONE heading per
   * group rather than the same heading several times down the menu.
   */
  group?: string;
};

function OptionVisual({ icon, swatch }: Pick<ConfigSelectOption, "icon" | "swatch">) {
  if (swatch != null) return swatch;
  if (icon != null) {
    return (
      <span className="cyber-select-icon" aria-hidden="true">
        {icon}
      </span>
    );
  }
  return <span className="cyber-select-swatch cyber-select-swatch-empty" aria-hidden="true" />;
}

/**
 * Nova's general configuration listbox. It deliberately uses the same
 * portalled, touch-sized cyber-select treatment as the theme and font
 * libraries instead of a platform <select>.
 */
export function ConfigSelect<T extends string>({
  ariaLabel,
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  label?: string;
  onChange: (value: T) => void;
  options: ConfigSelectOption<T>[];
  value: T;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const { containerRef, menuRef, menuStyle } = useSelectMenu(open, setOpen);
  const modalPortalTarget = useModalPortalTarget();
  const active = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );
  // Gather each group's options together, groups in first-appearance order.
  // Without this a caller whose list revisits a group (the status orb catalogue
  // interleaves climate and household entries) would render that heading once
  // per run instead of once in total.
  const orderedOptions = useMemo(() => {
    if (!options.some((option) => option.group)) return options;
    const byGroup = new Map<string, ConfigSelectOption<T>[]>();
    for (const option of options) {
      const key = option.group ?? "";
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(option);
      else byGroup.set(key, [option]);
    }
    return [...byGroup.values()].flat();
  }, [options]);

  if (!active) return null;

  return (
    <div className="grid gap-2">
      {label ? <p className="text-sm font-black uppercase text-cyan-200">{label}</p> : null}
      <div className="theme-library-select" ref={containerRef}>
        <button
          type="button"
          className={`cyber-select-trigger ${open ? "cyber-select-trigger-open" : ""}`}
          aria-label={ariaLabel ?? label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <OptionVisual icon={active.icon} swatch={active.swatch} />
          <span className="cyber-select-trigger-copy">
            <span className="cyber-select-trigger-name">{active.label}</span>
            {active.detail ? <span className="cyber-select-trigger-detail">{active.detail}</span> : null}
          </span>
          <ChevronDown className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`} aria-hidden="true" />
        </button>
        {open && menuStyle ? createPortal(
          <ul
            ref={menuRef}
            className="cyber-select-menu cyber-select-menu-portal"
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? label}
            style={menuStyle}
          >
            {orderedOptions.map((option, index) => {
              const selected = option.value === value;
              const heading = option.group && option.group !== orderedOptions[index - 1]?.group
                ? option.group
                : null;
              return (
                <Fragment key={option.value}>
                {heading ? (
                  <li className="cyber-select-group-heading" role="presentation">
                    {heading}
                  </li>
                ) : null}
                <li role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`cyber-select-option ${selected ? "cyber-select-option-active" : ""}`}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <OptionVisual icon={option.icon} swatch={option.swatch} />
                    <span className="cyber-select-trigger-copy">
                      <span className="cyber-select-option-name">{option.label}</span>
                      {option.detail ? <span className="cyber-select-trigger-detail">{option.detail}</span> : null}
                    </span>
                    {selected ? <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" /> : null}
                  </button>
                </li>
                </Fragment>
              );
            })}
          </ul>,
          modalPortalTarget?.current ?? document.body,
        ) : null}
      </div>
    </div>
  );
}
