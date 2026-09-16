"use client";

import { PartyPopper } from "lucide-react";
import { LabeledSlideSwitch } from "../../SlideSwitch";

/**
 * House Party for one zone: the visualiser may animate this zone's lights.
 * Lives in the zone's Advanced section (specs/advanced-fold.md); the master
 * switch stays on the Visualiser config page.
 */
export function HousePartyControl({
  disabled,
  enabled,
  onToggle,
}: {
  disabled: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="zone-party-control border border-fuchsia-400/30 bg-fuchsia-950/20 p-4">
      <div className="zone-party-control-row">
        <span className="zone-party-control-label">
        <PartyPopper className="h-6 w-6 text-fuchsia-300" aria-hidden="true" />
          House Party
        </span>
        <LabeledSlideSwitch
          checked={enabled}
          disabled={disabled}
          icon={<PartyPopper className="h-4 w-4" />}
          label="House Party"
          onChange={onToggle}
        />
      </div>
    </section>
  );
}
