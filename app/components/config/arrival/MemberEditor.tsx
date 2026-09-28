"use client";

import { useState } from "react";
import { hexToRgb } from "../../appleTVEncoderModel";
import { ColorEncoder } from "../../ColorEncoder";
import { hsvaToRgb, normalizeHsva, rgbToHex, rgbToHsv, type Hsva } from "../../colorEncoderModel";
import { CheckboxRow } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { ArrivalState } from "../../../../lib/config-schema/arrivals";
import type { ArrivalPresets, ArrivalTargetOption } from "./arrival-config-model";
import { StateList } from "./StateList";

/**
 * One household member: their name, the colour their washes are shown in, whether
 * they are the primary one for consumption attribution, and their two state lists.
 * The name is saved on blur, and the id it was derived from never moves with it —
 * /api/arrival/<id> is what a Shortcut holds.
 *
 * The colour is **the same rotary control the zones use** (`ColorEncoder`,
 * specs/color-encoder.md), as Adeline asked: a household member's colour is the
 * same kind of value as a light's, and the app has one colour dial rather than two
 * (2026-09-27). It is saved on **release**, not on every degree of the drag: the
 * dial's own `onCommit`, so one gesture is one write of the household config, while
 * `onChange` keeps the knob moving under the finger.
 */
export function MemberEditor({
  member,
  onColor,
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
  onColor: (color: string) => void;
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
  // The drag's own value, until the release commits it: the dial must follow the
  // finger, and the config must not be rewritten on every degree of the turn.
  const [dragging, setDragging] = useState<Hsva | null>(null);
  const colour = dragging ?? hsvaFromHex(member.color);

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
      <div className="flex flex-wrap items-center gap-3">
        <ColorEncoder
          ariaLabel={`${member.label} colour`}
          onChange={setDragging}
          onCommit={(next) => {
            setDragging(null);
            onColor(rgbToHex(hsvaToRgb(next)));
          }}
          size={56}
          value={colour}
        />
        <span className="text-xs text-neutral-500">
          Their colour, on the wash blocks and the laundry bill&apos;s rows
        </span>
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

/**
 * A stored `#rrggbb` as the dial's own HSVA, at full alpha.
 *
 * `ColorEncoder` speaks HSVA and every stored person colour is a hex, so the
 * conversion happens here, once, at the boundary. The parser is the app's existing
 * `hexToRgb` (it lives beside the Apple TV encoder and the temperature encoder
 * imports it for this same reason) rather than a second one written here.
 */
function hsvaFromHex(hex: string): Hsva {
  const { h, s, v } = rgbToHsv(hexToRgb(hex));
  return normalizeHsva({ a: 100, h, s, v });
}
