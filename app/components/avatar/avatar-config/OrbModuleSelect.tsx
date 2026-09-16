"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import type { NovaAvatarTheme } from "../theme-model/types";
import { useOrbModules } from "../../orbModules";
import { useSelectMenu } from "../../useSelectMenu";
import { OrbModuleSwatch } from "./OrbModuleSwatch";

/**
 * Drop-down selector for the status orb module (the layer stack the orb
 * draws with), styled after the theme library's cyber-select control. Lists
 * every module known to the host — built-ins plus any JSON files dropped
 * into `config/orb-modules/` — and writes the chosen id to the theme's
 * `avatar.orbModule`, so the orb style is part of the dark/light theme like
 * every other Status Orb setting.
 */
export function OrbModuleSelect({
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
