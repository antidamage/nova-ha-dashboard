"use client";

import type { PhonoscopeHouseParty } from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { CheckboxRow, ConfigAccordion } from "../ConfigControls";

/**
 * House Party's household controls.
 *
 * The master switch is the one control that stops the visualiser touching any
 * light at all; per-zone opt-in still applies on top of it and stays on the
 * zone cards. Hue and brightness moved here from the colour group, because they
 * were never really per-group — they describe how the room follows the picture.
 */
export function HousePartySection({
  houseParty,
  onChange,
}: {
  houseParty: PhonoscopeHouseParty;
  onChange: (houseParty: PhonoscopeHouseParty) => void;
}) {
  return (
    <ConfigAccordion
      id="phonoscope-house-party"
      title="House Party"
      className="border border-neutral-800 bg-neutral-950/30"
    >
      <div className="grid gap-3 p-3">
        <CheckboxRow
          checked={houseParty.enabled}
          detail="Lets the visualiser animate the lights in zones that have opted in. Off stops it everywhere at once."
          label="House Party"
          onChange={(enabled) => onChange({ ...houseParty, enabled })}
        />
        <ConfigSelect
          label="Hue"
          disabled={!houseParty.enabled}
          value={houseParty.hueMode}
          options={[
            { value: "follow", label: "Follow hue", detail: "Lights take the picture's colour." },
            { value: "complement", label: "Complement hue", detail: "Lights take its opposite." },
          ]}
          onChange={(hueMode) => onChange({ ...houseParty, hueMode: hueMode as PhonoscopeHouseParty["hueMode"] })}
        />
        <ConfigSelect
          label="Brightness"
          disabled={!houseParty.enabled}
          value={houseParty.brightnessMode}
          options={[
            { value: "follow", label: "Follow brightness" },
            { value: "oppose", label: "Oppose brightness", detail: "Dims as the picture brightens." },
            { value: "ignore", label: "Ignore brightness", detail: "Leaves each light at its own level." },
          ]}
          onChange={(brightnessMode) => onChange({
            ...houseParty,
            brightnessMode: brightnessMode as PhonoscopeHouseParty["brightnessMode"],
          })}
        />
      </div>
    </ConfigAccordion>
  );
}
