"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { ConfigAccordion, CheckboxRow } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { reidColorEntry } from "./clipboard";
import { useEditLock } from "./editing-lock";

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Genres the picker offers before the user types their own. */
const GENRE_SUGGESTIONS = [
  "Alternative", "Ambient", "Blues", "Classical", "Country", "Dance", "Drum & Bass",
  "Electronic", "Folk", "Funk", "Hip-Hop", "House", "Indie", "Jazz", "Metal", "Pop",
  "Punk", "R&B", "Reggae", "Rock", "Soul", "Soundtrack", "Techno", "Trance",
];

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

  const themeName = (id: string) => colorThemes.find((theme) => theme.id === id)?.name ?? "Missing theme";
  const groupName = (id: string) => settingsGroups.find((entry) => entry.id === id)?.name ?? id;

  const updateEntry = (entryId: string, patch: Partial<PhonoscopeColorGroupEntry>) =>
    onChange({
      ...group,
      entries: group.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry),
    });

  const moveEntry = (index: number, delta: -1 | 1) => {
    const next = [...group.entries];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...group, entries: next });
  };

  const moveSettings = (entry: PhonoscopeColorGroupEntry, index: number, delta: -1 | 1) => {
    const next = [...entry.settingsGroupIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateEntry(entry.id, { settingsGroupIds: next });
  };

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
          <ConfigAccordion
            key={entry.id}
            id={`entry-${entry.id}`}
            title={entry.altThemeId
              ? `${index + 1}. ${themeName(entry.themeId)} / ${themeName(entry.altThemeId)}`
              : `${index + 1}. ${themeName(entry.themeId)}`}
            className="border border-neutral-800 bg-neutral-950/45"
            actions={
              <span className="flex items-center gap-1">
                <span className="mr-2 text-xs text-neutral-500">
                  {entry.settingsGroupIds.map(groupName).join(", ")}
                </span>
                <CopyActions
                  kind="colorEntry"
                  label={themeName(entry.themeId)}
                  payload={entry}
                  onDuplicate={() => onChange({
                    ...group,
                    entries: [
                      ...group.entries.slice(0, index + 1),
                      reidColorEntry(entry),
                      ...group.entries.slice(index + 1),
                    ],
                  })}
                />
                <MomentaryFeedbackButton
                  type="button" className="icon-link" aria-label="Move entry earlier"
                  disabled={index === 0} onClick={() => moveEntry(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </MomentaryFeedbackButton>
                <MomentaryFeedbackButton
                  type="button" className="icon-link" aria-label="Move entry later"
                  disabled={index === group.entries.length - 1} onClick={() => moveEntry(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </MomentaryFeedbackButton>
                <MomentaryFeedbackButton
                  type="button" className="icon-link text-red-200" aria-label="Remove entry"
                  onClick={() => onChange({
                    ...group,
                    entries: group.entries.filter((candidate) => candidate.id !== entry.id),
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </MomentaryFeedbackButton>
              </span>
            }
          >
            <div className="grid gap-2 p-3">
              <ConfigSelect
                label="Colour theme"
                value={entry.themeId}
                options={colorThemes.map((theme) => ({ value: theme.id, label: theme.name }))}
                onChange={(themeId) => updateEntry(entry.id, {
                  themeId,
                  // An alt that has become the main theme is no longer an
                  // alternative to anything, so it is released rather than left
                  // pointing at the entry's own colours.
                  altThemeId: entry.altThemeId === themeId ? null : entry.altThemeId,
                })}
              />
              <ConfigSelect
                label="Alt theme"
                value={entry.altThemeId ?? ""}
                options={[
                  { value: "", label: "None" },
                  ...colorThemes
                    .filter((theme) => theme.id !== entry.themeId)
                    .map((theme) => ({ value: theme.id, label: theme.name })),
                ]}
                onChange={(altThemeId) => updateEntry(entry.id, { altThemeId: altThemeId || null })}
              />
              <div className="grid gap-1">
                <span className="text-xs font-black uppercase text-neutral-400">Settings groups</span>
                <p className="text-xs text-neutral-500">
                  Applied in order; the one further down wins.
                </p>
                {entry.settingsGroupIds.map((id, position) => (
                  <div key={`${id}-${position}`} className="flex items-center justify-between gap-2 border border-neutral-800 px-3 py-2 text-sm">
                    <span>{position + 1}. {groupName(id)}</span>
                    <span className="flex items-center gap-1">
                      <MomentaryFeedbackButton
                        type="button" className="icon-link" aria-label="Move settings group earlier"
                        disabled={position === 0} onClick={() => moveSettings(entry, position, -1)}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </MomentaryFeedbackButton>
                      <MomentaryFeedbackButton
                        type="button" className="icon-link" aria-label="Move settings group later"
                        disabled={position === entry.settingsGroupIds.length - 1}
                        onClick={() => moveSettings(entry, position, 1)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </MomentaryFeedbackButton>
                      <MomentaryFeedbackButton
                        type="button" className="icon-link text-red-200"
                        aria-label="Remove settings group"
                        disabled={entry.settingsGroupIds.length <= 1}
                        onClick={() => updateEntry(entry.id, {
                          settingsGroupIds: entry.settingsGroupIds.filter((_id, at) => at !== position),
                        })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </MomentaryFeedbackButton>
                    </span>
                  </div>
                ))}
                <ConfigSelect
                  label="Add settings group"
                  value=""
                  options={[
                    { value: "", label: "Add settings group…" },
                    ...settingsGroups
                      .filter((candidate) => !entry.settingsGroupIds.includes(candidate.id))
                      .map((candidate) => ({ value: candidate.id, label: candidate.name })),
                  ]}
                  onChange={(id) => {
                    if (!id) return;
                    updateEntry(entry.id, { settingsGroupIds: [...entry.settingsGroupIds, id] });
                  }}
                />
              </div>
              <PasteIntoButton
                kind="colorEntry"
                what="entry"
                onPaste={(pasted) => updateEntry(entry.id, {
                  themeId: pasted.themeId,
                  altThemeId: pasted.altThemeId ?? null,
                  settingsGroupIds: pasted.settingsGroupIds,
                })}
              />
            </div>
          </ConfigAccordion>
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

export function newColorGroup(moduleId: string, name: string): PhonoscopeColorGroup {
  return { id: newId("group"), moduleId, name, entries: [], genres: [], isDefault: false };
}

/**
 * Assigning a genre steals it. The editor performs the steal explicitly so the
 * most recent assignment is the one that survives normalisation, which resolves
 * duplicates first-wins.
 */
export function withExclusiveGenres(
  groups: PhonoscopeColorGroup[],
  ownerId: string,
): PhonoscopeColorGroup[] {
  const owner = groups.find((group) => group.id === ownerId);
  if (!owner) return groups;
  const claimed = new Set(owner.genres.map((genre) => genre.toLowerCase()));
  return groups.map((group) => group.id === ownerId ? group : {
    ...group,
    genres: group.genres.filter((genre) => !claimed.has(genre.toLowerCase())),
  });
}
