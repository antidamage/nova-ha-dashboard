"use client";

/**
 * The Design picker on the config page.
 *
 * Deliberately the same portalled cyber-listbox as ThemeLibraryControl — same
 * trigger/menu classes, same useSelectMenu positioning — because a design and a
 * colour theme are sibling choices and should not read as two different kinds
 * of control. It has no Save/Rename/Duplicate/Delete row: designs are a
 * registry, not a user-editable library.
 */
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { listDesigns } from "../design/registry";
import { readActiveDesignId, saveActiveDesignId } from "../design/activeDesign";
import { useSelectMenu } from "./useSelectMenu";

export function DesignSelectControl() {
  const designs = listDesigns();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const { containerRef, menuRef, menuStyle } = useSelectMenu(open, setOpen);

  // Read after mount, not during render: the id comes from a client-only
  // global, and the config page is server-rendered (SPEC.md §2 hydration rule).
  useEffect(() => {
    setActiveId(readActiveDesignId());
  }, []);

  const active = designs.find((design) => design.manifest.id === activeId) ?? null;

  const choose = async (id: string) => {
    setOpen(false);
    const previous = activeId;
    setActiveId(id);
    setError(null);
    try {
      await saveActiveDesignId(id);
    } catch (saveError) {
      setActiveId(previous);
      setError(saveError instanceof Error ? saveError.message : "Could not save the design");
    }
  };

  return (
    <div className="theme-library">
      <div className="theme-library-select" ref={containerRef}>
        <button
          type="button"
          className={`cyber-select-trigger ${open ? "cyber-select-trigger-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="cyber-select-swatch cyber-select-swatch-empty" aria-hidden="true" />
          <span className="cyber-select-trigger-copy">
            <span className="cyber-select-trigger-name zone-title-bar">
              {active?.manifest.name ?? "Loading…"}
            </span>
            <span className="cyber-select-trigger-detail">
              {active?.manifest.description ?? "Reading the active design"}
            </span>
          </span>
          <ChevronDown
            className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`}
            aria-hidden="true"
          />
        </button>

        {open && menuStyle
          ? createPortal(
              <ul
                ref={menuRef}
                className="cyber-select-menu cyber-select-menu-portal"
                id={listboxId}
                role="listbox"
                aria-label="Designs"
                style={menuStyle}
              >
                {designs.map((design) => {
                  const selected = design.manifest.id === activeId;
                  return (
                    <li key={design.manifest.id} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        className={`cyber-select-option ${selected ? "cyber-select-option-active" : ""}`}
                        onClick={() => void choose(design.manifest.id)}
                      >
                        <span className="cyber-select-swatch cyber-select-swatch-empty" aria-hidden="true" />
                        <span className="cyber-select-option-name">{design.manifest.name}</span>
                        {selected ? (
                          <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>,
              document.body,
            )
          : null}
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
