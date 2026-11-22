"use client";

import { useCallback, useEffect, useRef } from "react";
import { closeFold } from "./finger/scripts";

/** Idle exit on the live dashboard (specs/tutorial-mode.md, "Idle exit"). */
export const IDLE_EXIT_MS = 60_000;
/** While paused: a pause to read is never cut short, but one walked away from still closes. */
export const PAUSED_IDLE_EXIT_MS = 5 * 60_000;
const IDLE_CHECK_MS = 1_000;

/**
 * Closes the tour after 60 seconds without real input, counted from the later
 * of the last input and the moment the finger stopped. The finger's own
 * synthetic events are not input. Returns `touch`, for input the tour handles
 * itself (its keys, Replay).
 */
export function useIdleExit(enabled: boolean, playing: boolean, exit: () => void, limitMs = IDLE_EXIT_MS) {
  const lastRef = useRef(Date.now());
  const playingRef = useRef(playing);
  const limitRef = useRef(limitMs);
  limitRef.current = limitMs;
  const touch = useCallback(() => {
    lastRef.current = Date.now();
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) touch();
  }, [playing, touch]);

  useEffect(() => {
    if (!enabled) return;
    const onInput = (event: Event) => {
      if (event.isTrusted) touch();
    };
    const types = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const type of types) window.addEventListener(type, onInput, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      if (!playingRef.current && Date.now() - lastRef.current >= limitRef.current) exit();
    }, IDLE_CHECK_MS);
    return () => {
      for (const type of types) window.removeEventListener(type, onInput, { capture: true });
      window.clearInterval(timer);
    };
  }, [enabled, exit, touch]);

  return touch;
}

/**
 * The fold step opens a real fold; this closes it again when the step ends or
 * the tour exits, but only if the tour opened it (a fold already open at step
 * entry is never a target).
 */
export function useFoldRestore(fold: HTMLElement | null) {
  useEffect(() => {
    if (!fold) return;
    return () => closeFold(fold);
  }, [fold]);
}
