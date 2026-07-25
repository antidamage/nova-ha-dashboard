"use client";

import { Check, ChevronDown, CopyPlus, Pencil, Plus, Save, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ENGINE_VOICE_FIELD } from "../../lib/voice-settings";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import type { PersonalityLibraryEntry } from "./voicePersonalityLibrary";
import { useSelectMenu } from "./useSelectMenu";

/** Compact one-line summary of a personality: voice and pronoun set. */
function personalitySummary(entry: PersonalityLibraryEntry): string {
  // Show the voice for the engine this profile belongs to (the preset name
  // for Classic/legacy untagged, or that engine's own cloned/trained-voice id).
  const voiceField = ENGINE_VOICE_FIELD[entry.engine ?? "classic"];
  const voice = (entry.personality[voiceField] || "").replace(/_/g, " ");
  const { subjective, objective, possessive } = entry.personality.pronouns;
  return `${voice} · ${subjective}/${objective}/${possessive}`;
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

export function VoicePersonalityLibraryControl({
  activeId,
  dirty,
  entries,
  onDelete,
  onDuplicate,
  onLoad,
  onRename,
  onSaveAs,
  onSaveChanges,
  onTest,
}: {
  activeId: string | null;
  dirty: boolean;
  entries: PersonalityLibraryEntry[];
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSaveAs: (name: string) => void;
  onSaveChanges: () => void;
  onTest: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "saveAs" | "rename">("idle");
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    if (testing) {
      return;
    }
    setTesting(true);
    try {
      await onTest();
    } finally {
      setTesting(false);
    }
  };
  const listboxId = useId();
  const { containerRef, menuRef, menuStyle } = useSelectMenu(open, setOpen);

  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;

  const triggerLabel = activeEntry
    ? activeEntry.name
    : entries.length === 0
      ? "No saved personalities"
      : "Unsaved personality";
  const triggerDetail = activeEntry
    ? dirty ? "Loaded / unsaved edits" : personalitySummary(activeEntry)
    : "Live edits not yet saved";

  return (
    <div className="theme-library">
      <div className="theme-library-select" ref={containerRef}>
        <button
          type="button"
          className={`cyber-select-trigger cyber-select-trigger-plain ${open ? "cyber-select-trigger-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="cyber-select-trigger-copy">
            <span className="cyber-select-trigger-name zone-title-bar">{triggerLabel}</span>
            <span className="cyber-select-trigger-detail">{triggerDetail}</span>
          </span>
          <ChevronDown className={`cyber-select-chevron h-5 w-5 ${open ? "cyber-select-chevron-open" : ""}`} aria-hidden="true" />
        </button>

        {open && menuStyle ? createPortal(
          <ul
            ref={menuRef}
            className="cyber-select-menu cyber-select-menu-portal"
            id={listboxId}
            role="listbox"
            aria-label="Saved personalities"
            style={menuStyle}
          >
            {entries.length === 0 ? (
              <li className="cyber-select-empty" role="presentation">
                Save a personality to start your library.
              </li>
            ) : (
              entries.map((entry) => {
                const selected = entry.id === activeId;
                return (
                  <li key={entry.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={`cyber-select-option cyber-select-option-plain ${selected ? "cyber-select-option-active" : ""}`}
                      onClick={() => {
                        onLoad(entry.id);
                        setOpen(false);
                        setMode("idle");
                      }}
                    >
                      <span className="cyber-select-option-name">
                        {entry.name}
                        <span className="cyber-select-trigger-detail block normal-case">
                          {personalitySummary(entry)}
                        </span>
                      </span>
                      {selected ? <Check className="h-4 w-4 cyber-select-option-check" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>,
          document.body,
        ) : null}
      </div>

      {mode === "saveAs" ? (
        <NameField
          confirmLabel="Save personality"
          initialValue={activeEntry ? `${activeEntry.name} Copy` : "New personality"}
          placeholder="Personality name"
          onCancel={() => setMode("idle")}
          onConfirm={(name) => {
            onSaveAs(name);
            setMode("idle");
          }}
        />
      ) : mode === "rename" && activeEntry ? (
        <NameField
          confirmLabel="Rename personality"
          initialValue={activeEntry.name}
          placeholder="Personality name"
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
            className="theme-library-button"
            disabled={testing}
            onClick={() => void runTest()}
          >
            <Volume2 className={`h-4 w-4 ${testing ? "animate-pulse" : ""}`} />
            {testing ? "Playing…" : "Test"}
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
