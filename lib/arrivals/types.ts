import type { ArrivalTargetKind } from "../config-schema/arrivals";

export type { ArrivalTargetKind };

export type ArrivalEventKind = "arrival" | "departure";

/** One selectable preset, as the target publishes it. */
export type ArrivalPreset = {
  id: string;
  label: string;
  /** Optional heading the picker groups by — a room, for lighting. */
  group?: string;
};

/**
 * A device-state target. This is the whole extension point: a new kind is one
 * file exporting one of these, plus a line in ARRIVAL_TARGETS and one in the
 * schema's ARRIVAL_TARGET_KINDS. `presets()` may be empty — the picker then says
 * the target has none — and `apply` throws a message naming what is missing
 * rather than doing nothing quietly.
 */
export type ArrivalTarget = {
  kind: ArrivalTargetKind;
  /** What the target picker calls it. */
  label: string;
  presets: () => Promise<ArrivalPreset[]>;
  apply: (presetId: string) => Promise<void>;
};
