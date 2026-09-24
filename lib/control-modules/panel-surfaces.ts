import type { ControlPreset, ControlSlot, ControlSlotSurface } from "./types";

/**
 * The dashboard's panels, and the content each one came with
 * (specs/control-modules.md, "Every panel holds slots").
 *
 * Adeline, 2026-09-25: "every panel that isn't an existing modular control can
 * default to a single modular slot, with the current content as a module inside
 * of it, so no visible change, but still have the ability to reassign the
 * content."
 *
 * So a panel's own content IS a module — `panel-content`, whose renderer draws
 * whatever content the panel hands it — and the derivation places one per panel.
 * A home that has never configured anything therefore gets exactly the dashboard
 * it had before, and the Devices tab can still reassign, move or remove that
 * content without losing it.
 *
 * A file of its own rather than a block in `presets.ts`: that file is on the
 * 10 KB allowance and the panel list is the part of it that is DATA rather than
 * derivation (specs/agent-token-footprint.md §3).
 */

/** The module a panel's own content is placed as. */
export const PANEL_CONTENT_MODULE = "panel-content";

export const PANEL_SURFACES: readonly {
  /** One line for the Devices tab's group. */
  detail: string;
  name: string;
  presetId: string;
  surface: ControlSlotSurface;
}[] = [
  {
    detail: "The time, the date and the household's name",
    name: "Clock",
    presetId: "panel-clock",
    surface: "clock",
  },
  {
    detail: "The reminder icons and their states",
    name: "Reminders",
    presetId: "panel-reminders",
    surface: "reminders",
  },
  {
    detail: "The room menu: what each zone holds and which one is selected",
    name: "Zones",
    presetId: "panel-zones",
    surface: "zones",
  },
  {
    detail: "Every zone's own controls — its lights, climate, grid, network or outside cards",
    name: "Zone controls",
    presetId: "panel-zone",
    surface: "zone-panel",
  },
  {
    detail: "The reminder list",
    name: "Tasks",
    presetId: "panel-tasks",
    surface: "tasks",
  },
];

/** One preset per panel, holding that panel's own content. */
export function panelContentPresets(): ControlPreset[] {
  return PANEL_SURFACES.map((panel) => ({
    binding: {},
    driverId: null,
    features: {},
    id: panel.presetId,
    moduleId: PANEL_CONTENT_MODULE,
    name: panel.name,
    roomId: null,
    variant: null,
  }));
}

/** One slot per panel, holding that preset. */
export function panelContentSlots(): ControlSlot[] {
  return PANEL_SURFACES.map((panel) => ({
    id: `${panel.surface}-content`,
    presetId: panel.presetId,
    roomId: null,
    surface: panel.surface,
    visible: true,
  }));
}
