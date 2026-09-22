"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PowerWashingMachineSummary, WashBlock, WashGraphCycle } from "../../../../../lib/power";
import { MomentaryFeedbackButton } from "../../../MomentaryFeedbackButton";
import { classNames } from "../../shared";
import { GRAPH_HEIGHT, GRAPH_WIDTH } from "../meters-model";
import { personColor, washPlacement, washStep } from "./wash-timeline";

/**
 * The wash graph: one 12-hour block of washes, with a step button either side of
 * its own date and start/end times. Blocks are placed across the block's width,
 * each one a button that claims or reassigns the wash it holds.
 *
 * The card above owns the data (useWashHistory) and the attribution; this file
 * draws what it is handed. See specs/power-meters.md 5.2.
 */
export function WashTimeline({
  block,
  blocks,
  cursor,
  cycles,
  error,
  isPending,
  onClaim,
  onStep,
  people,
  personOf,
}: {
  block: WashBlock | null;
  blocks: number[];
  cursor: number | null;
  cycles: WashGraphCycle[];
  error: string | null;
  /** True while a tap on this wash has not yet been echoed by the server. */
  isPending: (cycleId: string) => boolean;
  onClaim: (cycleId: string, current: string | null) => void;
  onStep: (direction: -1 | 1) => void;
  people: PowerWashingMachineSummary["people"];
  personOf: (cycleId: string, serverPerson: string | null) => string | null;
}) {
  const peak = Math.max(0.01, ...cycles.map((cycle) => cycle.kwh));
  const earlier = washStep(blocks, cursor, -1) !== undefined;
  const later = washStep(blocks, cursor, 1) !== undefined;

  return (
    <>
      {/* The block's own bounds, above the graph: start time left, date centred,
          end time right, in the panel's small uppercase. The step buttons sit
          outside them, and skip the blocks that hold no wash. */}
      <div className="power-wash-nav mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <MomentaryFeedbackButton
          type="button"
          aria-label="Earlier 12-hour block with washes"
          className="power-wash-step"
          disabled={!earlier}
          onClick={() => onStep(-1)}
          title="Earlier 12-hour block"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </MomentaryFeedbackButton>
        <div className="power-wash-window grid grid-cols-3 items-center gap-2 text-xs font-black uppercase">
          <span className="text-neutral-400">{block?.startLabel ?? "--"}</span>
          <span className="text-center text-neutral-100">{block?.dateLabel ?? (error ? "Wash history unavailable" : "--")}</span>
          <span className="text-right text-neutral-400">{block?.endLabel ?? "--"}</span>
        </div>
        <MomentaryFeedbackButton
          type="button"
          aria-label="Later 12-hour block with washes"
          className="power-wash-step"
          disabled={!later}
          onClick={() => onStep(1)}
          title="Later 12-hour block"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </MomentaryFeedbackButton>
      </div>

      <div className="power-wash-graph relative border border-neutral-800 bg-neutral-900/60">
        <svg className="power-wash-svg" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="power-curve-grid" d={`M 0 10 H ${GRAPH_WIDTH} M 0 20 H ${GRAPH_WIDTH} M 0 30 H ${GRAPH_WIDTH}`} />
        </svg>
        <div className="power-wash-blocks">
          {cycles.length === 0 ? (
            <p className="power-wash-empty text-xs font-black uppercase text-neutral-600">No washes in this 12-hour block</p>
          ) : null}
          {block
            ? cycles.map((cycle) => {
                const person = personOf(cycle.id, cycle.person);
                const label = people.find((candidate) => candidate.id === person)?.label ?? "Unassigned";
                const { left, width } = washPlacement(cycle, block);
                // A pattern guess is hatched until someone taps it (§5.2).
                const guessed = person !== null && !isPending(cycle.id) && cycle.attribution?.source === "auto";
                const color = personColor(people, person);
                const curve = cycle.curve ?? [];
                const curvePeak = Math.max(1, ...curve);
                return (
                  // A plain button: the shared press flash painted a cyan box over the
                  // block and hid the new person colour for half a second (§7.6).
                  <button
                    key={cycle.id}
                    type="button"
                    aria-label={`${cycle.active ? "Active " : ""}${cycle.kwh.toFixed(2)} kWh wash, ${label}${guessed ? " (guessed)" : ""}. Tap to claim or reassign.`}
                    className={classNames("power-wash-block", guessed && "is-guessed")}
                    onClick={() => onClaim(cycle.id, person)}
                    style={{
                      background: guessed ? `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 7px), rgb(10 10 10 / 0.35)` : color,
                      borderColor: guessed ? color : undefined,
                      height: `${Math.max(14, (cycle.kwh / peak) * 100)}%`,
                      left: `${left}%`,
                      width: `${width}%`,
                    }}
                    title={`${cycle.active ? "Active — " : ""}${label}${guessed ? " (guessed)" : ""} / ${cycle.kwh.toFixed(2)} kWh`}
                  >
                    {curve.length > 1 ? (
                      <svg className="power-wash-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <polyline
                          points={curve
                            .map((watts, index) => `${(index / (curve.length - 1)) * 100},${100 - (watts / curvePeak) * 92}`)
                            .join(" ")}
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            : null}
        </div>
      </div>

      {error ? <p className="mt-2 text-xs font-black uppercase text-red-200">{error}</p> : null}
    </>
  );
}
