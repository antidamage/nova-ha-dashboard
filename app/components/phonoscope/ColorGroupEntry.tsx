"use client";

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { ConfigAccordion } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { reidColorEntry } from "./clipboard";

/**
 * One entry in a colour theme group's rotation playlist: its theme, its alt,
 * and the settings groups layered over it. Split out of `ColorGroupEditor.tsx`
 * (specs/agent-token-footprint.md §4); the handlers below are the ones that
 * closed over the editor's props.
 */
export function ColorGroupEntry({
  colorThemes,
  entry,
  group,
  index,
  onChange,
  settingsGroups,
}: {
  colorThemes: PhonoscopeColorTheme[];
  entry: PhonoscopeColorGroupEntry;
  group: PhonoscopeColorGroup;
  index: number;
  onChange: (group: PhonoscopeColorGroup) => void;
  settingsGroups: PhonoscopeSettingsGroup[];
}) {
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
  );
}
