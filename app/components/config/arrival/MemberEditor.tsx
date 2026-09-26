"use client";

import { CheckboxRow } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { ArrivalState } from "../../../../lib/config-schema/arrivals";
import type { ArrivalPresets, ArrivalTargetOption } from "./arrival-config-model";
import { StateList } from "./StateList";

/**
 * One household member: their name, whether they are the primary one for
 * consumption attribution, and their two state lists. The name is saved on blur,
 * and the id it was derived from never moves with it — /api/arrival/<id> is what
 * a Shortcut holds.
 */
export function MemberEditor({
  member,
  onRename,
  onRemove,
  onStateAdd,
  onStateRemove,
  onStateUpdate,
  onPrimary,
  presets,
  removable,
  targets,
}: {
  member: HouseholdPerson;
  onRename: (label: string) => void;
  onRemove: () => void;
  onPrimary: () => void;
  /** False for the only member: the endpoints need someone to answer to. */
  removable: boolean;
  onStateAdd: (event: "arrival" | "departure", state: ArrivalState) => void;
  onStateRemove: (event: "arrival" | "departure", index: number) => void;
  onStateUpdate: (event: "arrival" | "departure", index: number, state: ArrivalState) => void;
  presets: ArrivalPresets;
  targets: readonly ArrivalTargetOption[];
}) {
  return (
    <div className="grid gap-3 border border-neutral-700 bg-neutral-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Person name"
          className="cyber-date-input"
          defaultValue={member.label}
          key={`${member.id}-${member.label}`}
          onBlur={(event) => onRename(event.target.value)}
        />
        <span className="text-xs text-neutral-500">/api/arrival/{member.id}</span>
        <MomentaryFeedbackButton
          aria-label={`Remove ${member.label}`}
          disabled={!removable}
          onClick={onRemove}
        >
          Remove
        </MomentaryFeedbackButton>
      </div>
      <CheckboxRow
        checked={member.primary === true}
        detail="Used for shared consumption attribution"
        label="Primary"
        onChange={onPrimary}
      />
      <StateList
        event="arrival"
        onAdd={(state) => onStateAdd("arrival", state)}
        onRemove={(index) => onStateRemove("arrival", index)}
        onUpdate={(index, state) => onStateUpdate("arrival", index, state)}
        presets={presets}
        states={member.arrival}
        targets={targets}
      />
      <StateList
        event="departure"
        onAdd={(state) => onStateAdd("departure", state)}
        onRemove={(index) => onStateRemove("departure", index)}
        onUpdate={(index, state) => onStateUpdate("departure", index, state)}
        presets={presets}
        states={member.departure}
        targets={targets}
      />
    </div>
  );
}
