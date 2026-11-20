"use client";

import type { HomeZoneSetting } from "../../../../lib/config-schema/home-users";
import { CheckboxRow } from "../../ConfigControls";
import type { HomeUserRoom } from "./HomeUserFields";

/**
 * The Rooms list under the people (specs/home-users.md section 2): whether each
 * room is a bedroom, and whether it is lit for a later arrival after sunset.
 * Keyed by zone id, which a Home Assistant rename does not change.
 */
export function RoomFlagsEditor({
  rooms,
  zones,
  onChange,
}: {
  rooms: readonly HomeUserRoom[];
  zones: readonly HomeZoneSetting[];
  onChange: (zoneId: string, key: "bedroom" | "arrivalLight", value: boolean) => void;
}) {
  if (!rooms.length) return null;
  return (
    <div className="grid gap-2 border border-neutral-700 bg-neutral-950/50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-neutral-400">Rooms</p>
      {rooms.map((room) => {
        const setting = zones.find((zone) => zone.zoneId === room.id);
        return (
          <div key={room.id} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr] sm:items-center">
            <span className="text-sm text-neutral-200">{room.name}</span>
            <CheckboxRow
              checked={setting?.bedroom === true}
              label="Bedroom"
              onChange={(value) => onChange(room.id, "bedroom", value)}
            />
            <CheckboxRow
              checked={setting?.arrivalLight === true}
              label="Lit for a later arrival after sunset"
              onChange={(value) => onChange(room.id, "arrivalLight", value)}
            />
          </div>
        );
      })}
    </div>
  );
}
