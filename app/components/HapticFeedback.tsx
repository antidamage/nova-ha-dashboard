"use client";

import { useEffect } from "react";
import { buttonHaptic } from "./haptics";

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
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (enabledButton(event.target)) buttonHaptic();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
