"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { ConfigSelect } from "../../ConfigSelect";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { roomLabel } from "../../../../lib/control-modules/rooms";
import type { RoomOption } from "../../../../lib/control-modules/rooms";
import type { ControlSlot, ControlsConfig } from "../../../../lib/control-modules/types";

/**
 * The Quick Access row, as configuration (specs/control-modules.md).
 *
 * This is the "control slot" list: what the card shows, in order. It is
 * deliberately a list of placements rather than a copy of the presets — one
 * preset can be placed in several slots, and editing it changes every one of
 * them, so this panel only ever names a preset and says where it sits.
 *
 * A slot carries its own room, and a preset whose HA room is "inherit" takes it.
 * Order is the array order, which is what the up/down controls move.
 */
export function QuickAccessSlots({
  controls,
  onAdd,
  onMove,
  onRemove,
  rooms,
}: {
  controls: ControlsConfig;
  onAdd: (presetId: string) => void;
  onMove: (slotId: string, delta: number) => void;
  onRemove: (slotId: string) => void;
  rooms: readonly RoomOption[];
}) {
  const quick = controls.slots.filter((slot) => slot.surface === "quick-access");
  const placed = new Set(quick.map((slot) => slot.presetId));
  const available = controls.presets.filter((preset) => !placed.has(preset.id));

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
                : "Follows this slot's room"}
          </span>
        </span>
        <span className="slot-actions">
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Move ${preset?.name ?? ""} earlier`} disabled={index === 0} onClick={() => onMove(slot.id, -1)}>
            <ArrowUp className="h-4 w-4" />
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Move ${preset?.name ?? ""} later`} disabled={index === quick.length - 1} onClick={() => onMove(slot.id, 1)}>
            <ArrowDown className="h-4 w-4" />
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label={`Take ${preset?.name ?? ""} off Quick Access`} onClick={() => onRemove(slot.id)}>
            <X className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      </li>
    );
  };

  return (
    <div className="control-slots">
      <div className="control-slots-head">
        <h3>Quick Access</h3>
        <span className="control-slots-count">{quick.length ? `${quick.length} placed` : "empty"}</span>
      </div>
      {quick.length ? <ol className="slot-list">{quick.map(slotRow)}</ol> : (
        <p className="control-slots-empty">Nothing is on the card. Add a preset below and it appears here.</p>
      )}
      {available.length ? (
        <ConfigSelect
          label="Add a preset to Quick Access"
          options={[
            { label: "Choose a preset…", value: "" },
            ...available.map((preset) => ({ detail: preset.roomId ? roomLabel(preset.roomId, rooms) : "Follows the slot's room", label: preset.name, value: preset.id })),
          ]}
          value=""
          onChange={(presetId) => {
            if (presetId) {
              onAdd(presetId);
            }
          }}
        />
      ) : (
        <p className="control-slots-empty">Every preset you have is already on the card.</p>
      )}
    </div>
  );
}
