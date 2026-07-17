"use client";

import { Check, ChevronDown, CopyPlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { appliedThemeRgb, type DeviceThemeSet } from "./accentColor";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import type { LibraryEntry } from "./themeLibrary";

function rgbCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Three-band preview (surface / accent / highlight) drawn from a set's dark variant. */
function ThemeSwatch({ themeSet, className = "" }: { themeSet: DeviceThemeSet; className?: string }) {
  const base = themeSet.themes.dark;
  const background = rgbCss(appliedThemeRgb(base.background));
  const accent = rgbCss(appliedThemeRgb(base.accent));
  const highlight = rgbCss(appliedThemeRgb(base.highlight));

  return (
    <span
      aria-hidden="true"
      className={`cyber-select-swatch ${className}`}
      style={{ background: `linear-gradient(135deg, ${background} 0 40%, ${accent} 40% 70%, ${highlight} 70% 100%)` }}
    />
  );
}

function NameField({
  confirmLabel,
  initialValue,
  onCancel,
  onConfirm,
  placeholder,
}: {
  confirmLabel: string;
  initialValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div className="theme-library-name-field">
      <input
        ref={inputRef}
        className="cyber-text-input"
        type="text"
        maxLength={60}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <MomentaryFeedbackButton
        type="button"
        className="icon-link"
        aria-label={confirmLabel}
        disabled={!value.trim()}
        onClick={submit}
      >
        <Check className="h-5 w-5" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Cancel" onClick={onCancel}>
        <X className="h-5 w-5" />
      </MomentaryFeedbackButton>
    </div>
  );
}

export function ThemeLibraryControl({
  activeId,
  dirty,
  entries,
  onDelete,
  onDuplicate,
  onLoad,
  onRename,
  onSaveAs,
  onSaveChanges,
}: {
  activeId: string | null;
  dirty: boolean;
  entries: LibraryEntry[];
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSaveAs: (name: string) => void;
  onSaveChanges: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "saveAs" | "rename">("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerLabel = activeEntry
    ? activeEntry.name
    : entries.length === 0
      ? "No saved themes"
      : "Unsaved theme";
  const triggerDetail = activeEntry
    ? dirty ? "Loaded / unsaved edits" : "Loaded"
    : "Live edits not yet saved";

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
          {activeEntry ? <ThemeSwatch themeSet={activeEntry.themeSet} /> : <span className="cyber-select-swatch cyber-select-swatch-empty" aria-hidden="true" />}
          <span className="cyber-select-trigger-copy">
            <span className="cyber-select-trigger-name zone-title-bar">{triggerLabel}</span>
            <span className="cyber-select-trigger-detail">{triggerDetail}</span>
          </span>
          <ChevronDown className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`} aria-hidden="true" />
        </button>

        {open ? (
          <ul className="cyber-select-menu" id={listboxId} role="listbox" aria-label="Saved themes">
            {entries.length === 0 ? (
              <li className="cyber-select-empty" role="presentation">
                Save a theme to start your library.
              </li>
            ) : (
              entries.map((entry) => {
                const selected = entry.id === activeId;
                return (
                  <li key={entry.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={`cyber-select-option ${selected ? "cyber-select-option-active" : ""}`}
                      onClick={() => {
                        onLoad(entry.id);
                        setOpen(false);
                        setMode("idle");
                      }}
                    >
                      <ThemeSwatch themeSet={entry.themeSet} />
                      <span className="cyber-select-option-name">{entry.name}</span>
                      {selected ? <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>

      {mode === "saveAs" ? (
        <NameField
          confirmLabel="Save theme"
          initialValue={activeEntry ? `${activeEntry.name} Copy` : "New theme"}
          placeholder="Theme name"
          onCancel={() => setMode("idle")}
          onConfirm={(name) => {
            onSaveAs(name);
            setMode("idle");
          }}
        />
      ) : mode === "rename" && activeEntry ? (
        <NameField
          confirmLabel="Rename theme"
          initialValue={activeEntry.name}
          placeholder="Theme name"
          onCancel={() => setMode("idle")}
          onConfirm={(name) => {
            onRename(activeEntry.id, name);
            setMode("idle");
          }}
        />
      ) : (
        <div className="theme-library-actions">
          <MomentaryFeedbackButton
            type="button"
            className="theme-library-button"
            disabled={!activeEntry || !dirty}
            onClick={onSaveChanges}
          >
            <Save className="h-4 w-4" />
            Save
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="theme-library-button" onClick={() => setMode("saveAs")}>
            <Plus className="h-4 w-4" />
            Save As
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton
            type="button"
            className="theme-library-button"
            disabled={!activeEntry}
            onClick={() => setMode("rename")}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton
            type="button"
            className="theme-library-button"
            disabled={!activeEntry}
            onClick={() => activeEntry && onDuplicate(activeEntry.id)}
          >
            <CopyPlus className="h-4 w-4" />
            Duplicate
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton
            type="button"
            className="theme-library-button theme-library-button-danger"
            disabled={!activeEntry}
            onClick={() => activeEntry && onDelete(activeEntry.id)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </MomentaryFeedbackButton>
        </div>
      )}
    </div>
  );
}
