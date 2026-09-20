"use client";

/**
 * A stepping ring's thumb, drawn where it has reached rather than where it has
 * been sent: it closes on the ring's current stop at one fixed angular speed, so
 * a two- or three-stop jump reads as movement
 * (specs/color-encoder.md, "A step glides, it never snaps").
 *
 * Only a step asks a ring to glide — a ring with no step is never aimed at, and
 * still follows the pointer exactly. What a travelling thumb chases is the
 * ring's value *now*, so a drag that passes several stops travels once, straight
 * to the furthest one: the stops between are never queued, and releasing
 * part-way through a travel lets it finish rather than cutting it short. Full
 * lite snaps, as every other eased control on the surface does
 * (specs/experience-modes.md).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiteMode } from "../../dashboard/experienceModeSetting";
import { glideTowards } from "./ring-glide-model";

/** One travelling ring: where its thumb is drawn, and over what arc. */
type Travel = { drawn: number; sweep: number };

export type RingGlide = {
  /**
   * Starts a ring moving from the fraction it is drawn at now. Called just
   * before the value it is aiming at changes; a ring already travelling keeps
   * its thumb where it is and aims at the new stop from there.
   */
  aim: (id: string, from: number, sweep: number) => void;
  /** The fraction a travelling ring is drawn at, or null for one at rest. */
  reading: (id: string) => number | null;
};

/**
 * `live` answers the fraction every ring's value stands at right now. It is
 * called on each frame and never cached — re-reading the target every frame is
 * what makes a fast drag one movement, not a queue of them.
 */
export function useRingGlide(live: () => Record<string, number>): RingGlide {
  const lite = useLiteMode();
  const [, rerender] = useState(0);
  const travels = useRef<Record<string, Travel>>({});
  const liveRef = useRef(live);
  liveRef.current = live;
  const frameRef = useRef<number | null>(null);
  const atRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    atRef.current = null;
  }, []);

  const frame = useCallback((at: number) => {
    frameRef.current = null;
    // The first frame of a burst starts the clock and moves nothing: the time a
    // frame moved for is the gap since the previous one, and there is none yet.
    const elapsed = atRef.current === null ? 0 : at - atRef.current;
    atRef.current = at;
    const targets = liveRef.current();
    let moved = false;
    let travelling = false;
    for (const [id, travel] of Object.entries(travels.current)) {
      const target = targets[id];
      if (target === undefined) {
        delete travels.current[id];
        moved = true;
        continue;
      }
      const reached = glideTowards(travel.drawn, target, travel.sweep, elapsed);
      if (reached !== travel.drawn) {
        travel.drawn = reached;
        moved = true;
      }
      // Arrived: the ring is drawn from its own value again, which is where the
      // thumb now is.
      if (reached === target) delete travels.current[id];
      else travelling = true;
    }
    if (moved) rerender((count) => count + 1);
    if (travelling) frameRef.current = window.requestAnimationFrame(frame);
    // With nothing left travelling the burst is over, and the next one must
    // start its clock from scratch: a stale timestamp here would make the first
    // frame of the next glide look like it had been travelling for seconds, and
    // the thumb would arrive in one jump.
    else atRef.current = null;
  }, []);

  const aim = useCallback((id: string, from: number, sweep: number) => {
    if (lite) return;
    const travel = travels.current[id];
    if (travel) {
      travel.sweep = sweep;
      return;
    }
    travels.current[id] = { drawn: from, sweep };
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(frame);
  }, [frame, lite]);

  const reading = useCallback((id: string) => travels.current[id]?.drawn ?? null, []);

  // Full lite never animates, and a ring already travelling may not keep going.
  useEffect(() => {
    if (!lite) return;
    travels.current = {};
    stop();
  }, [lite, stop]);

  useEffect(() => () => stop(), [stop]);

  return { aim, reading };
}
