"use client";

import { resolveFeatures } from "../../../../lib/control-modules/features";
import type { ResolvedSlot } from "../../../../lib/control-modules/types";

/**
 * A lighting or climate slot before the first live snapshot has arrived
 * (specs/quick-access-card.md, "First paint"). It holds the slot's place so the
 * grid is final from the first frame, and carries nothing from Home Assistant:
 * it draws an inert dial until the snapshot turns it into its real control.
 */
export type QuickPendingItem = {
  key: string;
  kind: "pending";
  presetId: string;
  title: string;
  /** The renderer the slot is waiting on. */
  waitsFor: "lighting-dial" | "climate-knob";
  /** A lighting slot that will draw its preset row reserves it now. */
  presetRow: boolean;
};

/** Whether a slot drawn by this renderer needs the live snapshot to find its device. */
export function waitsForData(renderer: string | null): renderer is QuickPendingItem["waitsFor"] {
  return renderer === "lighting-dial" || renderer === "climate-knob";
}

export function pendingItem(resolved: ResolvedSlot, waitsFor: QuickPendingItem["waitsFor"]): QuickPendingItem {
  return {
    key: resolved.slot.id,
    kind: "pending",
    presetId: resolved.preset.id,
    presetRow: waitsFor === "lighting-dial" && resolveFeatures(resolved.module, resolved.preset)["preset-buttons"] !== false,
    title: resolved.preset.name,
    waitsFor,
  };
}
