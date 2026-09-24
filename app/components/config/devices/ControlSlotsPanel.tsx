"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { ConfigSelect } from "../../ConfigSelect";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { roomLabel } from "../../../../lib/control-modules/rooms";
import type { RoomOption } from "../../../../lib/control-modules/rooms";
import type { ControlSlot, ControlSlotSurface, ControlsConfig } from "../../../../lib/control-modules/types";

/**
 * One surface's placements, as configuration (specs/control-modules.md).
 *
 * This is the "control slot" list: what a surface shows, in order. It is
 * deliberately a list of placements rather than a copy of the presets — one
 * preset can be placed in several slots, and editing it changes every one of
 * them, so this panel only ever names a preset and says where it sits.
 *
 * It was Quick Access' own list until every panel gained slots (Adeline,
 * 2026-09-25); a panel's list is the same list asked for another surface, and the
 * panel's default row is the `panel-content` preset holding the content the panel
 * came with. Reassign it, move it, or take it off: the panel then shows only what
 * else is placed there.
 *
 * A slot carries its own room, and a preset whose HA room is "inherit" takes it.
 * Order is the array order, which is what the up/down controls move — within this
 * surface, never past another panel's placements.
 */
export function ControlSlotsPanel({
  controls,
  empty,
  inheritLabel = "Follows this slot's room",
  onAdd,
  onMove,
  onRemove,
  ownPresetId,
  rooms,
  surface,
}: {
  controls: ControlsConfig;
  /** What to say when nothing is placed here. */
  empty: string;
  /** How a slot with no room of its own reads; a panel's own room differs. */
  inheritLabel?: string;
  onAdd: (surface: ControlSlotSurface, presetId: string) => void;
  onMove: (slotId: string, delta: number) => void;
  onRemove: (slotId: string) => void;
  /**
   * This panel's own content preset. Only it may be placed here: another panel's
   * content draws that other panel's content, and offering it was a row that did
   * nothing (found in review).
   */
  ownPresetId?: string;
  rooms: readonly RoomOption[];
  surface: ControlSlotSurface;
}) {
  const placed = controls.slots.filter((slot) => slot.surface === surface);
  const onThisSurface = new Set(placed.map((slot) => slot.presetId));
  const available = controls.presets.filter(
    (preset) => !onThisSurface.has(preset.id) && (preset.moduleId !== "panel-content" || preset.id === ownPresetId),
  );

  const slotRow = (slot: ControlSlot, index: number) => {
    const preset = controls.presets.find((candidate) => candidate.id === slot.presetId);
    return (
      <li key={slot.id} className="slot-row">
        <span className="slot-index">{index + 1}</span>
        <span className="slot-main">
          <span className="slot-name">{preset?.name ?? slot.presetId}</span>
          <span className="slot-detail">
            {preset?.roomId
              ? `Serves ${roomLabel(preset.roomId, rooms)}`
              /* A slot with no room of its own has nothing to follow yet, and
                 saying "follows this slot's room · Inherit the room it is placed
                 in" would read as a room called that. */
              : slot.roomId
                ? `Follows this slot's room · ${roomLabel(slot.roomId, rooms)}`
                : inheritLabel}
          </span>
        </span>
        <span className="slot-actions">
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Move ${preset?.name ?? ""} earlier`} disabled={index === 0} onClick={() => onMove(slot.id, -1)}>
            <ArrowUp className="h-4 w-4" />
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Move ${preset?.name ?? ""} later`} disabled={index === placed.length - 1} onClick={() => onMove(slot.id, 1)}>
            <ArrowDown className="h-4 w-4" />
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Take ${preset?.name ?? ""} off this panel`} onClick={() => onRemove(slot.id)}>
            <X className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      </li>
    );
  };

  return (
    <div className="control-slots">
      {placed.length ? <ol className="slot-list">{placed.map(slotRow)}</ol> : (
        <p className="control-slots-empty">{empty}</p>
      )}
      {available.length ? (
        <ConfigSelect
          label="Add a preset here"
          options={[
            { label: "Choose a preset…", value: "" },
            ...available.map((preset) => ({ detail: preset.roomId ? roomLabel(preset.roomId, rooms) : "Follows the slot's room", label: preset.name, value: preset.id })),
          ]}
          value=""
          onChange={(presetId) => {
            if (presetId) {
              onAdd(surface, presetId);
            }
          }}
        />
      ) : (
        <p className="control-slots-empty">Every preset you have is already placed here.</p>
      )}
    </div>
  );
}
