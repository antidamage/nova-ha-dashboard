"use client";

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { PhonoscopeDriverLane, PhonoscopeSettingsGroup } from "../../../lib/types";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CopyActions } from "./ClipboardControls";
import { reidLane } from "./clipboard";
import { laneLabel } from "./driver-labels";

/**
 * A driver lane's header actions: its effect count, copy/duplicate, move and
 * remove. Split out of `DriverLaneCard` (specs/agent-token-footprint.md §4).
 */
export function DriverLaneActions({
  group,
  index,
  lane,
  moveLane,
  onChange,
  visibleBindings,
}: {
  group: PhonoscopeSettingsGroup;
  index: number;
  lane: PhonoscopeDriverLane;
  moveLane: (index: number, delta: -1 | 1) => void;
  onChange: (group: PhonoscopeSettingsGroup, commit?: boolean) => void;
  visibleBindings: (lane: PhonoscopeDriverLane) => unknown[];
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="mr-2 text-xs text-neutral-500">
        {/* Companions are parameters of the effect above them, so the
            count is of what the lane actually shows. */}
        {visibleBindings(lane).length} effect
        {visibleBindings(lane).length === 1 ? "" : "s"}
      </span>
      <CopyActions
        kind="lane"
        label={laneLabel(lane.driver, lane.modifiers)}
        payload={lane}
        onDuplicate={() => onChange({
          ...group,
          lanes: [
            ...group.lanes.slice(0, index + 1),
            reidLane(lane),
            ...group.lanes.slice(index + 1),
          ],
        })}
      />
      <MomentaryFeedbackButton
        type="button" className="icon-link" aria-label="Move lane earlier"
        disabled={index === 0} onClick={() => moveLane(index, -1)}
      >
        <ChevronUp className="h-4 w-4" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button" className="icon-link" aria-label="Move lane later"
        disabled={index === group.lanes.length - 1} onClick={() => moveLane(index, 1)}
      >
        <ChevronDown className="h-4 w-4" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button" className="icon-link text-red-200" aria-label="Remove lane"
        onClick={() => onChange({
          ...group,
          lanes: group.lanes.filter((entry) => entry.id !== lane.id),
        })}
      >
        <Trash2 className="h-4 w-4" />
      </MomentaryFeedbackButton>
    </span>
  );
}
