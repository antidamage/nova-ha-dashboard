"use client";

/**
 * Facade. The card lives in `./washing-machine/`; this file keeps the import path
 * stable for its caller (specs/agent-token-footprint.md 3.3).
 *
 *   washing-machine/WashingMachineCard.tsx  the card: attribution and month totals
 *   washing-machine/WashTimeline.tsx        the day graph and its labels
 *   washing-machine/wash-timeline.ts        pure graph shapes and helpers
 */
export { WashingMachineCard } from "./washing-machine/WashingMachineCard";
