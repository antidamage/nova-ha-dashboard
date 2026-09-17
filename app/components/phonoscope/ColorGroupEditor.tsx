"use client";

import { Plus, Trash2 } from "lucide-react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorTheme,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { ConfigAccordion, CheckboxRow } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { useEditLock } from "./editing-lock";
import { ColorGroupEntry } from "./ColorGroupEntry";
import { GENRE_SUGGESTIONS, newId } from "./color-group-model";

export { newColorGroup, withExclusiveGenres } from "./color-group-model";

/**
 * A colour theme group: the rotation playlist, its genre claims, and whether it
 * is the fallback.
 *
 * The playlist is ordered, and a theme may appear in several entries with
 * different settings groups, so the theme picker deliberately does not filter
 * out themes already used. The settings-group list inside an entry does filter,
 * because naming the same group twice means nothing.
 */
export function ColorGroupEditor({
  colorThemes,
  group,
  onChange,
  onDuplicate,
  onRemove,
  onSetDefault,
  settingsGroups,
}: {
  colorThemes: PhonoscopeColorTheme[];
  group: PhonoscopeColorGroup;
  onChange: (group: PhonoscopeColorGroup) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
  settingsGroups: PhonoscopeSettingsGroup[];
}) {
  // Holds the panel's state still while the name is being typed into.
  const editLock = useEditLock();

  return (
    <ConfigAccordion
      id={`color-group-${group.id}`}
      title={group.name}
      className="border border-neutral-800 bg-neutral-950/30"
      actions={
        <span className="flex items-center gap-2">
          {group.isDefault ? (
            <span className="text-xs font-black uppercase text-cyan-300">Default</span>
          ) : null}
          <span className="text-xs text-neutral-500">
            {group.entries.length} entr{group.entries.length === 1 ? "y" : "ies"}
          </span>
          <CopyActions
            kind="colorGroup"
            label={group.name}
            payload={group}
            onDuplicate={onDuplicate}
          />
          <MomentaryFeedbackButton
            type="button" className="icon-link text-red-200" aria-label={`Delete ${group.name}`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      }
    >
      <div className="grid gap-3 p-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-black uppercase text-neutral-400">Name</span>
          <input
            className="cyber-text-input"
            value={group.name}
            onChange={(event) => onChange({ ...group, name: event.target.value })}
            onFocus={editLock.onFocus}
            onBlur={editLock.onBlur}
          />
        </label>

        <CheckboxRow
          checked={group.isDefault}
          detail="Catches every track with no genre, or a genre no group has claimed. Exactly one group holds it."
          label="Default group"
          onChange={() => { if (!group.isDefault) onSetDefault(); }}
        />

        <fieldset className="grid gap-2 border border-neutral-800 p-3">
          <legend className="text-xs font-black uppercase text-neutral-400">Genres</legend>
          <p className="text-xs text-neutral-500">
            Genres are exclusive: assigning one here takes it from whichever group holds it now.
          </p>
          <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-3">
            {GENRE_SUGGESTIONS.map((genre) => (
              <label key={genre} className="flex items-center gap-1.5 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={group.genres.includes(genre)}
                  onChange={(event) => onChange({
                    ...group,
                    genres: event.target.checked
                      ? [...new Set([...group.genres, genre])]
                      : group.genres.filter((entry) => entry !== genre),
                  })}
                />
                {genre}
              </label>
            ))}
          </div>
        </fieldset>

        {group.entries.map((entry, index) => (
          <ColorGroupEntry
            key={entry.id}
            colorThemes={colorThemes}
            entry={entry}
            group={group}
            index={index}
            onChange={onChange}
            settingsGroups={settingsGroups}
          />
        ))}

        <MomentaryFeedbackButton
          type="button"
          className="config-page-button justify-center"
          disabled={!colorThemes.length || !settingsGroups.length}
          onClick={() => onChange({
            ...group,
            entries: [...group.entries, {
              id: newId("entry"),
              themeId: colorThemes[0]?.id ?? "",
              altThemeId: null,
              settingsGroupIds: [
                settingsGroups.find((candidate) => candidate.isDefault)?.id
                  ?? settingsGroups[0]?.id ?? "",
              ],
            }],
          })}
        >
          <Plus className="h-5 w-5" />
          Add entry
        </MomentaryFeedbackButton>
        <PasteIntoButton
          kind="colorGroup"
          what="colour theme group"
          onPaste={(pasted) => onChange({
            ...group,
            // The group keeps its identity, its name, its genre claims and its
            // default flag; only the playlist is replaced.
            entries: pasted.entries,
          })}
        />
      </div>
    </ConfigAccordion>
  );
}
