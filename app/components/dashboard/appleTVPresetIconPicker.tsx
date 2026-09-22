"use client";

/**
 * Choosing the icon a preset button wears (Adeline, 2026-09-22).
 *
 * The dashboard's established way to choose a glyph is the reminder sigil
 * picker — this is the same modal and the same tile treatment, down to
 * `reminder-picker-*`'s own classes — over this feature's own catalogue. The
 * reminder set is grouped by reminder life-area and carries no music mark at
 * all, so pointing this picker at it would offer a washing machine for a
 * playlist.
 *
 * The first tile is the note, and choosing it stores no icon at all: that is
 * how the shipped presets read, and it is how an icon is taken back off a
 * button.
 */
import { PRESET_ICON_CATALOG } from "../../../lib/apple-tv/preset-icons";
import { ModalOverlay } from "../ModalOverlay";
import { PresetIconMark } from "./appleTVPresetIcon";

export function AppleTVPresetIconPicker({
  icon,
  name,
  open,
  onClose,
  onSelect,
}: {
  /** The preset's stored icon, or null for the note. */
  icon: string | null;
  /** The playlist's name, so the dialog says what it is choosing an icon for. */
  name: string;
  open: boolean;
  onClose: () => void;
  /** A catalogue id, or null for the note. */
  onSelect: (icon: string | null) => void;
}) {
  const tile = (id: string | null, label: string) => {
    const selected = icon === id;
    return (
      <button
        key={id ?? "preset-icon-note"}
        type="button"
        className={`reminder-picker-option ${selected ? "reminder-picker-option-selected" : ""}`}
        title={label}
        aria-label={label}
        aria-pressed={selected}
        data-preset-icon={id ?? "note"}
        onClick={() => onSelect(id)}
      >
        <PresetIconMark className="h-6 w-6" icon={id} />
        <span className="reminder-picker-option-label">{label}</span>
      </button>
    );
  };

  return (
    <ModalOverlay open={open} onClose={onClose} ariaLabel={`Icon for ${name}`}>
      <div className="apple-tv-icon-picker grid max-h-[80vh] w-[min(720px,92vw)] gap-4 overflow-y-auto border border-neutral-700 bg-neutral-950 p-5">
        <header className="grid gap-1">
          <h2 className="theme-display-label zone-title-bar">Icon for {name}</h2>
          <p className="theme-display-detail">
            The mark this preset button wears. The note is no choice at all, and the one the shipped playlists wear.
          </p>
        </header>
        <div className="reminder-picker-grid">
          {tile(null, "Note")}
          {PRESET_ICON_CATALOG.map((entry) => tile(entry.id, entry.label))}
        </div>
      </div>
    </ModalOverlay>
  );
}
