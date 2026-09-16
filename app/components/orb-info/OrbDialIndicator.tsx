"use client";

// The status orb's dial indicator: the RotaryEncoder's sunken ring, index line
// and LED lines, laid over the orb face.
//
// Adeline, 2026-09-16: "the tap-and-dial function for the status orb ... should
// just be the existing dial indicator and lines that appear when we enable a
// temperature dial, following the same display rules." So this is not a second
// dial visual — it mounts the encoder's own classes (`.rotary-encoder-ring`,
// `-ring-shade`, `-rotor`/`-index`, `-leds`/`-led`) inside a `.rotary-encoder`
// root, and `data-locked` drives exactly the same fade the temperature knob
// uses when it tucks away. Only the geometry variables are ours, so the ring
// lands on the orb's rim instead of round a knob.
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
  /** Entries in the stack: one LED line each. */
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
    "--re-led-on": "var(--cyber-line)",
    "--re-led-on-rgb": "var(--cyber-line-rgb)",
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
        <span className="rotary-encoder-leds">
          {Array.from({ length: count }, (_, slot) => (
            <span key={slot} className="rotary-encoder-led-slot">
              <span className="rotary-encoder-led" data-lit={slot === index ? "true" : "false"} />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
