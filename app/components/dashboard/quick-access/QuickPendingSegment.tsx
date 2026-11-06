"use client";

import { RotaryEncoder } from "../../controls/rotary/RotaryEncoder";
import { QUICK_ENCODER_SIZE } from "./dial-model";
import type { QuickPendingItem } from "./quickSlotModel";

/**
 * A lighting or climate slot waiting for the first live snapshot
 * (specs/quick-access-card.md, "First paint"; alex, 2026-11-06: "it needs to
 * be dynamic, but it also needs to be able to render on the first pass").
 *
 * It is the real dial, in the box its control will take, so the card's grid and
 * every slot in it are final from the first frame and filling it in moves
 * nothing. It carries no value: nothing from Home Assistant is cached or painted,
 * so nothing can be sent from stale state. The dial is disabled (no pointer, key
 * or focus) and the segment ignores pointers so a touch on it scrolls the page;
 * the stylesheet keeps it at full strength rather than the dimmed disabled look,
 * so a loading dial does not read as a dead one beside the live amplifier dial.
 */
export function QuickPendingSegment({
  item,
  knobSkin,
  size = QUICK_ENCODER_SIZE,
}: {
  item: QuickPendingItem;
  /** Forwarded to the dial; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  size?: number;
}) {
  const lighting = item.waitsFor === "lighting-dial";
  const dial = (
    <div className="quick-slot-pending-dial" aria-hidden="true">
      <RotaryEncoder
        className={lighting ? "quick-access-encoder" : undefined}
        disabled
        knobSkin={knobSkin}
        leds={[]}
        range={{ max: 1, min: 0 }}
        size={size}
        // The climate knob carries its title arc; the lighting dial is untitled,
        // as its real control is, so both keep the box they will have.
        title={lighting ? undefined : item.title}
        value={0}
        onChange={() => undefined}
      />
    </div>
  );
  const label = `${item.title} loading`;
  if (!lighting) {
    return (
      <div className="quick-climate quick-segment-climate quick-slot-pending" role="group" aria-label={label} aria-busy="true">
        {dial}
      </div>
    );
  }
  return (
    <div className="quick-segment quick-segment-lights quick-slot-pending" role="group" aria-label={label} aria-busy="true">
      <div className="quick-segment-lead">{dial}</div>
      {item.presetRow ? <div className="quick-button-pair" aria-hidden="true" /> : null}
    </div>
  );
}
