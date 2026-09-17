// Labels and small helpers for the Modules tab: config export download,
// lifecycle state labels and the fallback field label.
import type { ModuleSummary } from "../../../../lib/modules/runtime/types";

export function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const STATE_LABEL: Record<ModuleSummary["state"], string> = {
  loaded: "Running",
  disabled: "Disabled",
  failed: "Failed",
};

export function fieldLabel(key: string, field: { title?: string }) {
  if (field.title) {
    return field.title;
  }
  // "queueIntervalMs" -> "Queue interval ms". A module that wants better writes
  // a title; this is only so a missing one is still readable.
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}
