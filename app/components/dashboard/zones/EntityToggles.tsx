"use client";

import type { DashboardEntity } from "../../../../lib/types";
import { SlideSwitch } from "../../SlideSwitch";

export function EntityToggles({
  candidates,
  selected,
  label,
  onChange,
}: {
  candidates: DashboardEntity[];
  selected: string[];
  label: string;
  onChange: (entityIds: string[]) => void;
}) {
  // Entities listed by a rule but not (or no longer) in the zone still show,
  // so a migrated rule never hides what it drives.
  const known = new Set(candidates.map((entity) => entity.entity_id));
  const rows = [
    ...candidates.map((entity) => ({ id: entity.entity_id, name: entity.name })),
    ...selected.filter((id) => !known.has(id)).map((id) => ({ id, name: id })),
  ];
  return (
    <div className="zone-light-event-switch-ons">
      {rows.map((row) => (
        <div key={row.id} className="zone-light-event-switch-on">
          <span className="zone-lighting-label">{row.name}</span>
          <SlideSwitch
            checked={selected.includes(row.id)}
            label={`${label} ${row.name}`}
            onChange={() => {
              const next = selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id];
              if (next.length) onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
