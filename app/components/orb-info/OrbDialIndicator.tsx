"use client";

// The status orb's dial indicator: the RotaryEncoder's sunken ring and index
// line, laid over the orb face.
//
// Adeline, 2026-09-16: "the tap-and-dial function for the status orb ... should
// just be the existing dial indicator and lines that appear when we enable a
// temperature dial, following the same display rules." So this is not a second
// dial visual — it mounts the encoder's own classes (`.rotary-encoder-ring`,
// `-ring-shade`, `-rotor`/`-index`) inside a `.rotary-encoder` root, and
// `data-locked` drives exactly the same fade the temperature knob uses when it
// tucks away. Only the geometry variables are ours, so the ring lands on the
// orb's rim instead of round a knob.
//
// Adeline, 2026-09-16: the orb takes the ring and the index mark only — no
// LEDs. The orb face is a readout, not a knob face, and the lights sat on top
// of it.
//
// specs/status-orb-stack.md, "The dial is the RotaryEncoder indicator".

import type { CSSProperties } from "react";
import { orbDialMarkAngle } from "./orbDialModel";

// --re-outer is --re-size * (1 + 2*0.1 ring + 2*0.022 bevel). Dividing the orb
// diameter by that puts the outer edge of the ring on the orb's rim.
const OUTER_RATIO = 1.244;

export function OrbDialIndicator({
  count,
  index,
  open,
  size,
}: {
  /** Entries in the stack: the index mark's positions round the ring. */
  count: number;
  /** The entry on show. */
  index: number;
  /** Unlocked — the indicator is showing. */
  open: boolean;
  /** Orb diameter in px. */
  size: number;
}) {
  const style = {
    "--re-size": `${size / OUTER_RATIO}px`,
    "--re-color": "var(--cyber-line)",
    "--re-angle": `${orbDialMarkAngle(index, count)}deg`,
  } as CSSProperties;

  return (
    <div
      className="rotary-encoder orb-dial-indicator"
      data-locked={open ? "false" : "true"}
      style={style}
      aria-hidden
    >
      <div className="rotary-encoder-dial">
        <span className="rotary-encoder-ring" />
        <span className="rotary-encoder-ring-shade" />
        <span className="rotary-encoder-rotor">
          <span className="rotary-encoder-index" />
        </span>
      </div>
    </div>
  );
}
