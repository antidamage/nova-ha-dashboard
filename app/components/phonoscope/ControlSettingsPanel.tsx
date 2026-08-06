"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { CheckboxRow, ConfigAccordion } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { ColorGroupEditor, newColorGroup, withExclusiveGenres } from "./ColorGroupEditor";
import { reidColorGroup, reidSettingsGroup } from "./clipboard";
import { HousePartySection } from "./HousePartySection";
import { SettingsGroupCard, newSettingsGroup } from "./SettingsGroupLibrary";
import { effectCatalogue, effectGroups, type ModuleSetting } from "./effectCatalogue";

export type ControlSettings = {
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  chooseColorGroupByGenre: boolean;
  soloColorThemeId: string;
  soloSettingsGroupId: string;
  structuralSettings: Record<string, number>;
  houseParty: PhonoscopeHouseParty;
};

/**
 * The behaviour half of Visualiser controls, as a flat run of sections.
 *
 * Behaviour and colour are two independent libraries. A colour theme group is
 * where they meet: an ordered playlist whose entries each pair one colour theme
 * with one or more settings groups.
 */
export function ControlSettingsPanel({
  colorThemeLibrary,
  moduleId,
  moduleSettings,
  onChange,
  value,
}: {
  /** The colour theme library, rendered beside the settings groups it pairs with. */
  colorThemeLibrary?: ReactNode;
  moduleId: string;
  moduleSettings: ModuleSetting[];
  onChange: (value: ControlSettings, commit?: boolean) => void;
  value: ControlSettings;
}) {
  const catalogue = effectCatalogue(moduleSettings);
  const groups = effectGroups(catalogue, moduleSettings);
  const staticSettings = moduleSettings.filter((setting) => setting.updateMode === "structural");
  const mine = <T extends { moduleId: string }>(items: T[]) =>
    items.filter((item) => item.moduleId === moduleId);
  const settingsGroups = mine(value.settingsGroups);
  const colorThemes = mine(value.colorThemes);
  const colorGroups = mine(value.colorGroups);

  const replaceSettingsGroups = (next: PhonoscopeSettingsGroup[], commit = true) => onChange({
    ...value,
    settingsGroups: [...value.settingsGroups.filter((g) => g.moduleId !== moduleId), ...next],
  }, commit);
  const replaceColorGroups = (next: PhonoscopeColorGroup[]) => onChange({
    ...value,
    colorGroups: [...value.colorGroups.filter((g) => g.moduleId !== moduleId), ...next],
  }, true);

  // No "Control settings" wrapper: these four are top-level sections in their
  // own right, so they sit as siblings and get the exclusive-accordion
  // behaviour against the rest of the panel rather than only against each
  // other. There is also no system-wide structural section — nothing currently
  // belongs to it, and visual complexity lives on each settings group so
  // playlist entries can run the field at different densities.
  return (
    <>
      <HousePartySection
        houseParty={value.houseParty}
        onChange={(houseParty) => onChange({ ...value, houseParty }, true)}
      />

      <ConfigAccordion
        id="phonoscope-color-groups"
        title="Colour theme groups"
        className="border border-neutral-800 bg-neutral-950/30"
      >
        <div className="grid gap-3 p-3">
          <CheckboxRow
            checked={value.chooseColorGroupByGenre}
            detail="Picks the group by the playing track's genre. Anything unclaimed falls back to the group flagged default."
            label="Choose colour theme group by genre"
            onChange={(chooseColorGroupByGenre) =>
              onChange({ ...value, chooseColorGroupByGenre }, true)}
          />
          {colorGroups.map((group) => (
            <ColorGroupEditor
              key={group.id}
              colorThemes={colorThemes}
              group={group}
              settingsGroups={settingsGroups}
              onChange={(next) => replaceColorGroups(
                withExclusiveGenres(
                  colorGroups.map((entry) => entry.id === next.id ? next : entry), next.id))}
              onRemove={() => replaceColorGroups(colorGroups.filter((entry) => entry.id !== group.id))}
              onDuplicate={() => replaceColorGroups([
                ...colorGroups,
                { ...reidColorGroup(group), name: `${group.name} copy` },
              ])}
              onSetDefault={() => replaceColorGroups(colorGroups.map((entry) => ({
                ...entry,
                isDefault: entry.id === group.id,
              })))}
            />
          ))}
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button justify-center"
            onClick={() => replaceColorGroups([
              ...colorGroups,
              {
                ...newColorGroup(moduleId, `Colour group ${colorGroups.length + 1}`),
                isDefault: colorGroups.length === 0,
              },
            ])}
          >
            <Plus className="h-5 w-5" />
            Add colour theme group
          </MomentaryFeedbackButton>
        </div>
      </ConfigAccordion>

      {colorThemeLibrary}

      <ConfigAccordion
        id="phonoscope-settings-groups"
        title="Settings"
        className="border border-neutral-800 bg-neutral-950/30"
      >
        <div className="grid gap-3 p-3">
          {settingsGroups.map((group) => (
            <SettingsGroupCard
              key={group.id}
              catalogue={catalogue}
              effectGroups={groups}
              group={group}
              staticSettings={staticSettings}
              onChange={(next, commit) => replaceSettingsGroups(
                settingsGroups.map((entry) => entry.id === next.id ? next : entry), commit)}
              onDuplicate={() => replaceSettingsGroups([
                ...settingsGroups,
                { ...reidSettingsGroup(group), name: `${group.name} copy` },
              ])}
              onRemove={() => replaceSettingsGroups(
                settingsGroups.filter((entry) => entry.id !== group.id))}
              soloed={value.soloSettingsGroupId === group.id}
              onSolo={() => onChange({
                ...value,
                soloSettingsGroupId: value.soloSettingsGroupId === group.id ? "" : group.id,
              }, true)}
            />
          ))}
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button justify-center"
            onClick={() => replaceSettingsGroups([
              ...settingsGroups,
              newSettingsGroup(moduleId, `Settings ${settingsGroups.length + 1}`),
            ])}
          >
            <Plus className="h-5 w-5" />
            Add settings group
          </MomentaryFeedbackButton>
        </div>
      </ConfigAccordion>
    </>
  );
}
