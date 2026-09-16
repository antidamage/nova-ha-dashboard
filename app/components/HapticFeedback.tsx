"use client";

import { useEffect } from "react";
import { buttonHaptic, triggerHaptic, uxSoundActionFor } from "./haptics";
import { useSoundLibrary } from "./dashboard/useSoundLibrary";

const BUTTON_SELECTOR = "button, [role='button']";

function enabledButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest(BUTTON_SELECTOR);
  if (!button) return null;
  if (button.matches(":disabled, [aria-disabled='true']")) return null;
  return button;
}

/** Adds one crisp audible/tactile confirmation to every successful button activation. */
export function HapticFeedback() {
  // Every surface that plays UX sounds mounts this, so it is also where the
  // sound library is kept current (specs/ux-sounds.md).
  useSoundLibrary();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = enabledButton(event.target);
      if (!button) return;
      // Zone and menu buttons declare `sectionChange`; a control that plays its
      // own sound declares "none" (specs/ux-sounds.md, "Precedence").
      const action = uxSoundActionFor(button);
      if (action) buttonHaptic(action);
      else triggerHaptic("button");
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
