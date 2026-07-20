"use client";

import { useCallback } from "react";
import {
  CONTROL_INTERACTION_COOLDOWN_MS,
  isControlInteractionCoolingDown,
  markControlInteraction,
} from "./controlInteractionCooldown";

// After a user touches any settings control, all config pollers hold off
// applying polled or pushed snapshots until six seconds after release. This is
// intentionally global: a poll owned by one mounted section must not clobber a
// control being edited in another section.
export const SETTING_INTERACTION_COOLDOWN_MS = CONTROL_INTERACTION_COOLDOWN_MS;

export function useSettingCooldown(cooldownMs: number = SETTING_INTERACTION_COOLDOWN_MS) {
  const markInteraction = useCallback(() => {
    markControlInteraction(cooldownMs);
  }, [cooldownMs]);

  // Pollers must check before starting a request and again after every await,
  // before applying the response.
  const isCoolingDown = useCallback(() => isControlInteractionCoolingDown(), []);

  return { isCoolingDown, markInteraction };
}
