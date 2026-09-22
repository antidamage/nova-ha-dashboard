import { ROOM_INHERIT } from "./types";
import type { ControlPreset, ControlSlot } from "./types";

/**
 * Which room a preset serves (specs/control-modules.md).
 *
 * A preset either names a room or inherits the one its slot is placed in —
 * `null` means inherit, and that is the whole vocabulary. "Inherit" is what
 * makes a preset reusable: the same Lounge air conditioner preset dropped into
 * another room's panel is wrong, while "this room's lights" is right in every
 * room it is placed in.
 */

/** The zone `lib/ha/zones.ts` assembles for "every light except those excluded". */
export const HOME_ZONE_ID = "everything";

export const ROOM_INHERIT_LABEL = "Inherit the room it is placed in";
export const ROOM_UNASSIGNED_LABEL = "Every room";

export type RoomOption = { id: string; name: string; detail?: string };

export type ResolvedRoom = {
  roomId: string | null;
  /** True when the room came from the slot rather than from the preset. */
  inherited: boolean;
};

/**
 * The room a placed preset serves. A preset that inherits takes the slot's
 * room; a preset with no slot (one being edited, or listed in the Devices tab)
 * keeps its own answer, which may still be "inherit".
 */
export function resolveRoom(preset: ControlPreset, slot?: ControlSlot | null): ResolvedRoom {
  if (preset.roomId !== ROOM_INHERIT) {
    return { roomId: preset.roomId, inherited: false };
  }
  return { roomId: slot?.roomId ?? null, inherited: true };
}

export function roomLabel(roomId: string | null, rooms: readonly RoomOption[]): string {
  if (roomId === ROOM_INHERIT) {
    return ROOM_INHERIT_LABEL;
  }
  if (!roomId) {
    return ROOM_UNASSIGNED_LABEL;
  }
  return rooms.find((room) => room.id === roomId)?.name ?? roomId;
}

/** How a preset's own room answer reads in the Devices list. */
export function presetRoomLabel(preset: ControlPreset, rooms: readonly RoomOption[]): string {
  return roomLabel(preset.roomId, rooms);
}
