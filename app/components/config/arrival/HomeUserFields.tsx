"use client";

import { useState } from "react";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import { DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT } from "../../../../lib/config-schema/home-users";
import { hexToRgb } from "../../appleTVEncoderModel";
import { CheckboxRow, SliderControlPanel } from "../../ConfigControls";
import { ConfigSelect } from "../../ConfigSelect";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { quickAccessKey, quickAccessOptions, type QuickAccessOption } from "./home-users-config-model";

/**
 * One person's Home Users fields (specs/home-users.md section 8): their rooms,
 * whether they see the system tabs, their night maximum brightness and their
 * Quick Access card. Every control is an existing config control; each change
 * is one write, made by the section.
 */

export type HomeUserRoom = { id: string; name: string };
export type HomeUserPresetOption = { id: string; name: string; moduleId: string };

function entryLabel(key: string, options: QuickAccessOption[]) {
  return options.find((option) => option.value === key)?.label ?? key;
}

export function HomeUserFields({
  member,
  presets,
  rooms,
  onAddQuickAccess,
  onMoveQuickAccess,
  onNightMax,
  onRemoveQuickAccess,
  onSystemTabs,
  onToggleRoom,
}: {
  member: HouseholdPerson;
  presets: readonly HomeUserPresetOption[];
  rooms: readonly HomeUserRoom[];
  onAddQuickAccess: (key: string) => void;
  onMoveQuickAccess: (index: number, by: -1 | 1) => void;
  onNightMax: (pct: number) => void;
  onRemoveQuickAccess: (index: number) => void;
  onSystemTabs: (show: boolean) => void;
  onToggleRoom: (zoneId: string) => void;
}) {
  const roomIds = new Set(member.rooms ?? []);
  const nightMax = member.nightMaxBrightnessPct ?? DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT;
  const [previewNightMax, setPreviewNightMax] = useState<number | null>(null);
  const shownNightMax = previewNightMax ?? nightMax;
  const colour = hexToRgb(member.color);
  const options = quickAccessOptions(rooms, presets);
  const taken = new Set((member.quickAccess ?? []).map(quickAccessKey));
  const addable = options.filter((option) => !taken.has(option.value));

  return (
    <div className="grid gap-3">
      <p className="text-xs font-black uppercase tracking-wide text-neutral-400">Rooms</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rooms.map((room) => (
          <CheckboxRow
            key={room.id}
            checked={roomIds.has(room.id)}
            label={room.name}
            onChange={() => onToggleRoom(room.id)}
          />
        ))}
      </div>
      <CheckboxRow
        checked={member.showSystemTabs === true}
        detail="Home and the Systems tabs: Climate, Outside, World, Network, Grid, Reminders, Voice"
        label="Show system tabs"
        onChange={onSystemTabs}
      />
      <SliderControlPanel
        ariaLabel={`${member.label} night maximum brightness`}
        ariaValueText={`${shownNightMax}%`}
        color={colour}
        label="Night maximum brightness"
        max={100}
        min={1}
        step={1}
        value={shownNightMax}
        valueText={`${shownNightMax}%`}
        onPreview={setPreviewNightMax}
        onCommit={(next) => {
          setPreviewNightMax(null);
          onNightMax(Math.round(next));
        }}
        markers={[{ active: nightMax === DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT, label: "Default", value: DEFAULT_NIGHT_MAX_BRIGHTNESS_PCT }]}
      />
      <p className="text-xs font-black uppercase tracking-wide text-neutral-400">Quick Access</p>
      {(member.quickAccess ?? []).length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing yet. Add controls from {member.label}&apos;s rooms below.</p>
      ) : null}
      {(member.quickAccess ?? []).map((entry, index, list) => (
        <div key={quickAccessKey(entry)} className="flex flex-wrap items-center gap-2">
          <span className="min-w-40 text-sm text-neutral-200">{entryLabel(quickAccessKey(entry), options)}</span>
          <MomentaryFeedbackButton aria-label="Move up" disabled={index === 0} onClick={() => onMoveQuickAccess(index, -1)}>
            Up
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton
            aria-label="Move down"
            disabled={index === list.length - 1}
            onClick={() => onMoveQuickAccess(index, 1)}
          >
            Down
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton aria-label="Remove from Quick Access" onClick={() => onRemoveQuickAccess(index)}>
            Remove
          </MomentaryFeedbackButton>
        </div>
      ))}
      {addable.length ? (
        <ConfigSelect<string>
          ariaLabel={`Add to ${member.label}'s Quick Access`}
          label="Add to Quick Access"
          options={[{ value: "", label: "Choose a control" }, ...addable]}
          value=""
          onChange={(key) => {
            if (key) onAddQuickAccess(key);
          }}
        />
      ) : null}
    </div>
  );
}
