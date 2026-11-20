"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setUxQuiet } from "../../uxQuiet";
import type { TutorialScriptId } from "../steps";
import { FingerPress } from "./dispatch";
import { compileGestures, durationOf, sampleAt, type Point, type Sample } from "./gesture-model";
import { SCRIPT_PARTS, scriptMode } from "./scripts";

/** Three plays, then Replay (specs/tutorial-mode.md, "The finger"). */
export const FINGER_LOOPS = 3;
/** The rest between plays: the motion extract's `xl`. */
export const LOOP_REST_MS = 1200;

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
};

const frame = () => new Promise<number>((resolve) => window.requestAnimationFrame(resolve));
const wait = (ms: number, alive: () => boolean) =>
  new Promise<void>((resolve) => {
    const started = performance.now();
    const tick = () => (!alive() || performance.now() - started >= ms ? resolve() : window.requestAnimationFrame(tick));
    window.requestAnimationFrame(tick);
  });

/**
 * Plays a step's script on the copy with synthetic events, three times, then
 * stops. A real press on the copy cancels it at once and it never resumes on
 * its own; `replay` starts it again from a fresh copy.
 */
export function useFingerDriver({ script, getRoot, within, reset, draw, reducedMotion }: Options) {
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const runRef = useRef(0);
  const pressRef = useRef<FingerPress | null>(null);
  const options = useRef({ getRoot, within, reset, draw, reducedMotion });
  options.current = { getRoot, within, reset, draw, reducedMotion };

  const stop = useCallback(() => {
    runRef.current += 1;
    pressRef.current?.cancel();
    pressRef.current = null;
    setUxQuiet(false);
    setPlaying(false);
    options.current.draw({ point: null, pressed: false });
  }, []);

  useEffect(() => {
    if (SCRIPT_PARTS[script].length === 0) return;
    const id = ++runRef.current;
    const alive = () => runRef.current === id;
    const press = new FingerPress(scriptMode(script), (element) => options.current.within(element));
    pressRef.current = press;

    const playSamples = async (samples: Sample[]) => {
      const started = performance.now();
      let done = -1;
      const length = durationOf(samples);
      while (alive()) {
        const t = performance.now() - started;
        const index = sampleAt(samples, Math.min(t, length));
        for (let at = done + 1; at <= index; at += 1) {
          const sample = samples[at];
          const point = { x: sample.x, y: sample.y };
          if (sample.edge === "down") press.down(point);
          else if (sample.edge === "up") press.up(point);
          else if (sample.pressed) press.move(point);
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
      setUxQuiet(true);
      let at: Point | null = null;
      for (let loop = 0; loop < FINGER_LOOPS && alive(); loop += 1) {
        await options.current.reset();
        for (const part of SCRIPT_PARTS[script]) {
          if (!alive()) break;
          const root = options.current.getRoot();
          if (!root) break;
          const gestures = part(root);
          if (gestures.length === 0) continue;
          const rect = root.getBoundingClientRect();
          const start = at ?? { x: rect.right + 24, y: rect.bottom + 24 };
          const last = await playSamples(compileGestures(gestures, start));
          if (last) at = { x: last.x, y: last.y };
        }
        if (loop < FINGER_LOOPS - 1) await wait(LOOP_REST_MS, alive);
      }
      if (!alive()) return;
      setUxQuiet(false);
      setPlaying(false);
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

  const replay = useCallback(() => setRun((count) => count + 1), []);
  return { playing, replay, stop };
}
