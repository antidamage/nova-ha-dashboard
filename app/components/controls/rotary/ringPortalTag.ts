"use client";

import { createContext, useContext } from "react";

/**
 * A tag a subtree can put on the ring layers its dials portal to the body, so
 * something that owns those dials can tell their floating rings from every
 * other dial's. The tutorial's sandbox copies set it to "tutorial"
 * (specs/tutorial-mode.md). Unset everywhere else: no attribute is written.
 */
export const RingPortalTagContext = createContext<string | undefined>(undefined);

export function useRingPortalTag() {
  return useContext(RingPortalTagContext);
}
