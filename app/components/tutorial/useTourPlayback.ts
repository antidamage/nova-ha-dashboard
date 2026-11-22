"use client";

import { useCallback, useEffect, useState } from "react";
import type { FingerHandle } from "./finger/Finger";
import { useFingerDriver } from "./finger/useFingerDriver";
import type { TutorialStep } from "./steps";
import { useThemeCycle } from "./useThemeCycle";

/** What the caption panel's one playback slot offers (specs/tutorial-mode.md, "Pause and Resume"). */
export type PlaybackSlot = "pause" | "resume" | "replay" | null;

type Options = {
  step: TutorialStep | undefined;
  target: HTMLElement | null;
  getRoot: () => HTMLElement | null;
  within: (element: Element) => boolean;
  reset: () => Promise<void>;
  draw: FingerHandle["draw"];
  reduced: boolean;
  onSay: (text: string | null) => void;
};

/**
 * A step's playback: the finger's script, or the theme step's mode cycle, and
 * the one slot that pauses, resumes or replays it.
 */
export function useTourPlayback({ step, target, getRoot, within, reset, draw, reduced, onSay }: Options) {
  const driver = useFingerDriver({
    script: step && target ? step.script : "none",
    getRoot,
    within,
    reset,
    draw,
    reducedMotion: reduced,
    onSay,
  });
  const cycling = Boolean(step?.themeCycle && target);
  const [cyclePaused, setCyclePaused] = useState(false);
  useEffect(() => setCyclePaused(false), [step]);
  useThemeCycle(cycling, cycling ? target : null, cyclePaused, reduced, onSay);

  const paused = cycling ? cyclePaused : driver.playing && driver.paused;
  let slot: PlaybackSlot = null;
  if (cycling || driver.playing) slot = paused ? "resume" : "pause";
  else if (step && step.script !== "none") slot = "replay";

  const { pause, resume, replay } = driver;
  const press = useCallback(() => {
    if (slot === "replay") replay();
    else if (cycling) setCyclePaused(slot === "pause");
    else if (slot === "pause") pause();
    else if (slot === "resume") resume();
  }, [cycling, pause, replay, resume, slot]);

  return { driving: driver.playing, paused, slot, press, stop: driver.stop };
}
