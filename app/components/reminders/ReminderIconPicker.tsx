"use client";

// Sigil picker for one reminder. Two ways to answer:
//
//   * a Phosphor icon from the curated catalogue, grouped and searchable
//   * a 1-2 character text glyph, because some reminders are a letter and
//     nothing else ("E" for estrogen) and no icon set has letterforms
//
// Whichever is chosen becomes a `source: "user"` assignment, which the LLM
// classifier is forbidden from overwriting for the life of that reminder.

import { useMemo, useState } from "react";

import {
  REMINDER_GLYPH_TEXT_MAX_LENGTH,
  REMINDER_ICON_CATALOG,
  REMINDER_ICON_GROUP_LABELS,
  type ReminderGlyph,
  type ReminderIconGroup,
} from "../../../lib/reminder-glyph";
import { ModalOverlay } from "../ModalOverlay";
import { ReminderGlyphMark } from "./icon-registry";

const GROUP_ORDER: ReminderIconGroup[] = ["health", "hygiene", "home", "money", "life"];

export function ReminderIconPicker({
  glyph,
  open,
  reminderName,
  onClose,
  onSelect,
}: {
  glyph: ReminderGlyph;
  open: boolean;
  reminderName: string;
  onClose: () => void;
  onSelect: (glyph: ReminderGlyph) => void;
}) {
  const [query, setQuery] = useState("");
  const [text, setText] = useState(glyph.kind === "text" ? glyph.value : "");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = REMINDER_ICON_CATALOG.filter((entry) => {
      if (!needle) {
        return true;
      }
      return (
        entry.label.toLowerCase().includes(needle) ||
        entry.id.includes(needle) ||
        entry.keywords.some((keyword) => keyword.includes(needle))
      );
    });

    return GROUP_ORDER.map((group) => ({
      group,
      entries: matches.filter((entry) => entry.group === group),
    })).filter((section) => section.entries.length > 0);
  }, [query]);

  const trimmedText = text.trim().slice(0, REMINDER_GLYPH_TEXT_MAX_LENGTH);

  return (
    <ModalOverlay open={open} onClose={onClose} ariaLabel={`Icon for ${reminderName}`}>
      <div className="reminder-picker grid max-h-[80vh] w-[min(720px,92vw)] gap-4 overflow-y-auto border border-neutral-700 bg-neutral-950 p-5">
        <header className="grid gap-1">
          <h2 className="theme-display-label zone-title-bar">Icon for {reminderName}</h2>
          <p className="theme-display-detail">
            Your choice sticks. Automatic classification never overwrites it.
          </p>
        </header>

        <label className="grid gap-1">
          <span className="theme-display-detail">Letter or symbol</span>
          <div className="flex items-center gap-3">
            <input
              className="min-h-11 w-24 border border-neutral-700 bg-neutral-950/70 px-3 py-2 text-center font-mono text-lg font-black uppercase text-neutral-100 outline-none focus:border-cyan-300"
              maxLength={REMINDER_GLYPH_TEXT_MAX_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="E"
            />
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-4 py-1 text-xs font-black uppercase text-cyan-100 disabled:opacity-40"
              disabled={!trimmedText}
              onClick={() => onSelect({ kind: "text", value: trimmedText })}
            >
              Use this
            </button>
          </div>
        </label>

        <label className="grid gap-1">
          <span className="theme-display-detail">Search icons</span>
          <input
            className="min-h-11 w-full border border-neutral-700 bg-neutral-950/70 px-3 py-2 font-mono text-sm font-black uppercase text-neutral-100 outline-none focus:border-cyan-300"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="washing, rent, pill…"
          />
        </label>

        {groups.map((section) => (
          <section key={section.group} className="grid gap-2">
            <h3 className="theme-display-detail">{REMINDER_ICON_GROUP_LABELS[section.group]}</h3>
            <div className="reminder-picker-grid">
              {section.entries.map((entry) => {
                const selected = glyph.kind === "phosphor" && glyph.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`reminder-picker-option ${selected ? "reminder-picker-option-selected" : ""}`}
                    title={entry.label}
                    aria-label={entry.label}
                    aria-pressed={selected}
                    onClick={() => onSelect({ kind: "phosphor", id: entry.id })}
                  >
                    <ReminderGlyphMark glyph={{ kind: "phosphor", id: entry.id }} />
                    <span className="reminder-picker-option-label">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {groups.length === 0 ? (
          <p className="theme-display-detail">No icons match “{query}”.</p>
        ) : null}
      </div>
    </ModalOverlay>
  );
}
