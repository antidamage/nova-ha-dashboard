"use client";

import type {
  PowerFloatingMeterSummary,
  PowerWashingMachineSummary,
} from "../../../../lib/power";
import type { PowerDisplayMode } from "../power-format";
import { FloatingMeterCard } from "./FloatingMeterCard";
import { WashingMachineCard } from "./WashingMachineCard";

/**
 * The two metering plugs, in the main part of the Grid panel.
 *
 * Kept in its own file rather than inlined into PowerPanel: the panel is a
 * shared surface under frequent edit, and these two cards have no business
 * widening its diff. See specs/power-meters.md §5.
 */

export function PowerMeters({
  displayMode,
  floatingMeter,
  washingMachine,
}: {
  displayMode: PowerDisplayMode;
  floatingMeter?: PowerFloatingMeterSummary;
  washingMachine?: PowerWashingMachineSummary;
}) {
  if (!floatingMeter && !washingMachine) {
    return null;
  }
  return (
    <div className="power-meter-grid mt-5 grid gap-3">
      {washingMachine ? <WashingMachineCard displayMode={displayMode} summary={washingMachine} /> : null}
      {floatingMeter ? <FloatingMeterCard summary={floatingMeter} /> : null}
    </div>
  );
}
