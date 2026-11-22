"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TutorialScriptId } from "../steps";
import { FingerPress } from "./dispatch";
import { compileGestures, durationOf, sampleAt, type Point, type Sample } from "./gesture-model";
import { PlayClock } from "./playClock";
import { SCRIPT_PARTS, scriptMode } from "./scripts";

/** Three plays, then Replay (specs/tutorial-mode.md, "The finger"). */
export const FINGER_LOOPS = 3;
/** The rest between plays: the motion extract's `xl`. */
export const LOOP_REST_MS = 1200;
/**
 * Resume carries on in place after a pause shorter than this; longer, and the
 * play starts again from a fresh copy. Under the orb dial's 5s idle close and
 * a climate dial's relock, the copies' own timers a pause cannot hold.
 */
export const RESUME_IN_PLACE_MS = 3000;

export type FingerView = { point: Point | null; pressed: boolean };

type Options = {
  script: TutorialScriptId;
  /** The element the gestures are read off and sent to: the copy, or the real fold. */
  getRoot: () => HTMLElement | null;
  /** Everything the finger may press: the copy and its portalled rings. */
  within: (element: Element) => boolean;
  /** Puts the copy back to its starting state; resolves once it has remounted. */
  reset: () => Promise<void>;
  /** Draws the finger; called per frame, outside React. */
  draw: (view: FingerView) => void;
  reducedMotion: boolean;
  /** A phase's caption as the script reaches it; null at the top of each play. */
  onSay?: (text: string | null) => void;
};

const frame = () => new Promise<number>((resolve) => window.requestAnimationFrame(resolve));
const wait = (ms: number, alive: () => boolean, clock: PlayClock) =>
  new Promise<void>((resolve) => {
    const started = clock.now();
    const tick = () => (!alive() || clock.now() - started >= ms ? resolve() : window.requestAnimationFrame(tick));
    window.requestAnimationFrame(tick);
  });

/**
 * Plays a step's script on the copy with synthetic events, three times, then
 * stops. A real press on the copy cancels it at once and it never resumes on
 * its own; `replay` starts it again from a fresh copy. `pause` freezes the
 * script's clock (a pause during a tap waits for its release, so the dial
 * never sees a long press; during a drag the pointer stays down) and `resume`
 * carries on from the same point.
 */
export function useFingerDriver({ script, getRoot, within, reset, draw, reducedMotion, onSay }: Options) {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const runRef = useRef(0);
  const pressRef = useRef<FingerPress | null>(null);
  const clockRef = useRef(new PlayClock());
  const pauseWanted = useRef(false);
  const inTap = useRef(false);
  const pausedAt = useRef<number | null>(null);
  const options = useRef({ getRoot, within, reset, draw, reducedMotion, onSay });
  options.current = { getRoot, within, reset, draw, reducedMotion, onSay };

  const stop = useCallback(() => {
    runRef.current += 1;
    pressRef.current?.cancel();
    pressRef.current = null;
    clockRef.current = new PlayClock();
    pauseWanted.current = false;
    pausedAt.current = null;
    inTap.current = false;
    setPlaying(false);
    setPaused(false);
    options.current.draw({ point: null, pressed: false });
  }, []);

  const pause = useCallback(() => {
    if (clockRef.current.paused || pausedAt.current !== null) return;
    // Shown as paused at once; during a tap the clock stops at its release.
    pausedAt.current = performance.now();
    setPaused(true);
    if (inTap.current) pauseWanted.current = true;
    else clockRef.current.pause();
  }, []);

  const resume = useCallback(() => {
    const held = pausedAt.current === null ? 0 : performance.now() - pausedAt.current;
    pausedAt.current = null;
    pauseWanted.current = false;
    setPaused(false);
    // The copies keep their own idle timers (a climate dial relocks, the orb's
    // dial closes after 5s), which a pause cannot hold. After a long pause the
    // copy is no longer where the script left it, so the play starts again
    // from a fresh copy rather than carrying on against the wrong state.
    if (held >= RESUME_IN_PLACE_MS) setRun((count) => count + 1);
    else clockRef.current.resume();
  }, []);

  useEffect(() => {
    if (SCRIPT_PARTS[script].length === 0) return;
    const id = ++runRef.current;
    const alive = () => runRef.current === id;
    const press = new FingerPress(scriptMode(script), (element) => options.current.within(element));
    pressRef.current = press;
    const clock = new PlayClock();
    clockRef.current = clock;
    pausedAt.current = null;
    pauseWanted.current = false;
    setPaused(false);

    const playSamples = async (samples: Sample[]) => {
      const started = clock.now();
      let done = -1;
      const length = durationOf(samples);
      while (alive()) {
        const t = clock.now() - started;
        const index = sampleAt(samples, Math.min(t, length));
        for (let at = done + 1; at <= index; at += 1) {
          const sample = samples[at];
          const point = { x: sample.x, y: sample.y };
          if (sample.edge === "down") {
            press.down(point);
            inTap.current = samples[at + 1]?.edge === "up";
          } else if (sample.edge === "up") {
            press.up(point);
            inTap.current = false;
            if (pauseWanted.current) {
              pauseWanted.current = false;
              clock.pause();
            }
          } else if (sample.pressed) press.move(point);
          if (!options.current.reducedMotion || sample.edge || at === samples.length - 1) {
            options.current.draw({ point, pressed: sample.pressed || sample.edge === "down" });
          }
        }
        done = index;
        if (t >= length) return samples[samples.length - 1];
        await frame();
      }
      return null;
    };

    void (async () => {
      setPlaying(true);
      let at: Point | null = null;
      for (let loop = 0; loop < FINGER_LOOPS && alive(); loop += 1) {
        await options.current.reset();
        options.current.onSay?.(null);
        for (const part of SCRIPT_PARTS[script]) {
          if (!alive()) break;
          if (typeof part !== "function") {
            options.current.onSay?.(part.say);
            continue;
          }
          const root = options.current.getRoot();
          if (!root) break;
          const gestures = part(root);
          if (gestures.length === 0) continue;
          const rect = root.getBoundingClientRect();
          const start = at ?? { x: rect.right + 24, y: rect.bottom + 24 };
          const last = await playSamples(compileGestures(gestures, start));
          if (last) at = { x: last.x, y: last.y };
        }
        if (loop < FINGER_LOOPS - 1) await wait(LOOP_REST_MS, alive, clock);
      }
      if (!alive()) return;
      setPlaying(false);
      setPaused(false);
      options.current.draw({ point: null, pressed: false });
    })();

    // A real press on the copy is the user taking over: the finger stops.
    const onTrustedDown = (event: PointerEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      if (!options.current.within(event.target)) return;
      stop();
    };
    window.addEventListener("pointerdown", onTrustedDown, true);
    return () => {
      window.removeEventListener("pointerdown", onTrustedDown, true);
      if (alive()) stop();
    };
  }, [script, run, stop]);

  const replay = useCallback(() => {
    pauseWanted.current = false;
    setPaused(false);
    setRun((count) => count + 1);
  }, []);
  return { playing, paused, pause, resume, replay, stop };
}
