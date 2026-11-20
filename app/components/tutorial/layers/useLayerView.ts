"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { isLiteFeatures, readExperienceFeatures } from "../../dashboard/experienceModeSetting";
import { FingerPress } from "../finger/dispatch";
import type { TutorialStep } from "../steps";
import type { LayerSetId } from "./catalogue";

/** Long enough for a freshly unlocked knob's rings to finish unfolding. */
const UNFOLD_WAIT_MS = 900;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export type LayerView = { setId: LayerSetId; control: Element | null };

/**
 * Opening "How was this control built?" from a tour step
 * (specs/tutorial-mode.md). The finger stops; a locked climate copy is
 * unlocked first, so its rings are there to be drawn; the control is the
 * copy's knob, the real orb (its glass and counter live only there), or the
 * page for the background. Lite mode never offers it: every card is a canvas.
 */
export function useLayerView(step: TutorialStep | undefined, copyRef: RefObject<HTMLDivElement | null>, stopFinger: () => void) {
  const [view, setView] = useState<LayerView | null>(null);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  // Bumped on every step change: an open still waiting for a knob to unfold
  // must not land on the step that came after it.
  const generation = useRef(0);
  const available = Boolean(step?.layers) && !isLiteFeatures(readExperienceFeatures());

  // A step change closes it: it belongs to the step it was opened on.
  useEffect(() => {
    generation.current += 1;
    setView(null);
  }, [step]);

  const open = useCallback(async () => {
    if (!step?.layers || busy.current) return;
    busy.current = true;
    setOpening(true);
    const mine = generation.current;
    stopFinger();
    try {
      const copy = copyRef.current;
      let control: Element | null = null;
      if (step.layers === "rotary") {
        control = copy?.querySelector(".rotary-encoder") ?? null;
        const dial = control?.querySelector<HTMLElement>(".rotary-encoder-dial");
        if (control?.getAttribute("data-locked") === "true" && dial) {
          const rect = dial.getBoundingClientRect();
          const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const press = new FingerPress("pointer", (element) => Boolean(copy?.contains(element)));
          press.down(centre);
          await wait(200);
          press.up(centre);
          await wait(UNFOLD_WAIT_MS);
        }
      } else if (step.layers === "orb") {
        control = document.querySelector(".nova-avatar-host");
      }
      if (generation.current !== mine || (copy && !copy.isConnected)) return;
      setView({ setId: step.layers, control });
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }, [copyRef, step, stopFinger]);

  // Also cancels an open still waiting for a knob to unfold (Esc mid-wait).
  const close = useCallback(() => {
    generation.current += 1;
    setView(null);
  }, []);
  return { view, available, open, close, opening };
}
