/**
 * Control modules — the assignable device types behind the dashboard's
 * configurable controls (specs/control-modules.md).
 *
 * A module says what a thing IS and what it can do: the settings a preset
 * carries, the features it can be switched into, the behaviours it links into,
 * and which renderer draws it. A **preset** is one configured instance of a
 * module, saved locally. A **slot** is a place on a dashboard surface that
 * holds a preset.
 *
 * Two layers, deliberately:
 *   control — the control as it appears on the dashboard ("Air Conditioner /
 *             Heater", "Room Lighting", "Outside Weather").
 *   driver  — how one kind of hardware is actually driven ("Gree Air
 *             Conditioner", "Sample Heater WiFi Switch"). A control preset
 *             names the driver it runs on, so the same control can be pointed
 *             at a different make of device without the control changing.
 *
 * Nothing here imports React or zod: the server derives instances from these
 * shapes and the client renders them, and both sides must agree.
 */

/**
 * The renderers this build ships. A control module names one; a driver has none.
 * A listing rather than a bare union because an installed module package is
 * validated against it at runtime (lib/control-modules/library.ts).
 */
export const SHIPPED_RENDERER_IDS = [
  "climate-knob",
  "lighting-dial",
  "amplifier-dial",
  "weather-readings",
  // The odd one out, deliberately: it draws the content the PANEL hands it,
  // which is how every panel's own content becomes a module that can be placed,
  // moved or taken off (Adeline, 2026-09-25).
  "panel-content",
] as const;
export type ControlRendererId = (typeof SHIPPED_RENDERER_IDS)[number];

/**
 * The reading order a control announces for the surface it is placed on: the
 * dial line, the climate knobs, the trailing readings.
 *
 * It no longer decides a module's row. A panel is a grid of equal slots and the
 * slot's own order is its position in it (Adeline, 2026-09-25;
 * specs/control-modules.md, "Slots and the Quick Access row"), so a module's
 * region is what it declares rather than what places it. The field stays because
 * it is part of a module's definition and travels in a package — a package that
 * carries it must still round-trip.
 */
export type QuickRegion = "dial-line" | "climate" | "readings";

/** A preset whose room follows the slot it is placed in stores `null`. */
export const ROOM_INHERIT = null;

export type ControlLayer = "control" | "driver";

/** Which binding field a preset carries. Module-driven, so the form is generated. */
export const CONTROL_MODULE_FIELD_IDS = [
  "entityId",
  "matchTokens",
  "switchEntityIds",
  "temperatureEntityIds",
  "humidityEntityIds",
  "dryTargetHumidityPct",
] as const;
export type ControlModuleFieldId = (typeof CONTROL_MODULE_FIELD_IDS)[number];

export type ControlModuleField = {
  id: ControlModuleFieldId;
  label: string;
  detail: string;
  kind: "entity" | "entity-list" | "token-list" | "number" | "zone";
  /**
   * Which live entities the editor offers for this field. An id is free text —
   * any string is a legal Home Assistant entity id — so a picker is an
   * invitation, not a constraint; what it replaces is the owner having to know
   * an id by heart.
   */
  candidates?: "climate" | "switch" | "sensor";
  /** Shown as "required" in the editor; the model reports it as a problem. */
  required?: boolean;
};

/** One setting a preset may switch off, e.g. a driver's Quiet fan support. */
export type ControlFeature = {
  id: string;
  label: string;
  detail: string;
  /** Off leaves the control exactly as it behaves without this feature. */
  default: boolean;
  /** Only meaningful with these drivers; the editor greys it out otherwise. */
  driverIds?: string[];
  /**
   * Only meaningful for these variants of the module. An air conditioner's fan
   * ring has no counterpart on the heater, and a checkbox that can be switched
   * off without changing anything is worse than one that is not offered.
   */
  variantIds?: string[];
};

/** A control that can be configured as either of two things, e.g. aircon or heater. */
export type ControlVariant = {
  id: string;
  label: string;
  detail: string;
};

export type ControlModule = {
  id: string;
  name: string;
  /** One line for the device-type list. */
  summary: string;
  /** A paragraph for the editor's heading. */
  detail: string;
  category: string;
  layer: ControlLayer;
  /** The renderer that draws a preset of this module. Drivers have none. */
  renderer: ControlRendererId | null;
  /** The reading order the module announces. Drivers have none. */
  region: QuickRegion | null;
  /** Present when a preset of this module must choose one. */
  variants: ControlVariant[];
  /** Behaviour ids this module links into (a control) or provides (a driver). */
  behaviours: string[];
  features: ControlFeature[];
  fields: ControlModuleField[];
  /** Driver module ids a preset of this control may be assigned. */
  driverIds: string[];
  /** For a driver: the renderer/variant it plugs into. */
  driverFor: { renderer: ControlRendererId; variant: string } | null;
  /** Whether a preset of this module can be placed in a dashboard slot. */
  placeable: boolean;
};

/** A saved preset: one configured instance of a module. */
export type ControlPreset = {
  id: string;
  moduleId: string;
  name: string;
  /** HA area id, or `null` for "inherit the room I am placed in". */
  roomId: string | null;
  /** The driver module this preset runs on, when its module takes one. */
  driverId: string | null;
  /** Which variant was chosen, when the module has variants. */
  variant: string | null;
  /** Feature id -> enabled. A missing entry means the module's default. */
  features: Record<string, boolean>;
  /** The device binding. Which fields are meaningful comes from the module. */
  binding: ControlPresetBinding;
};

export type ControlPresetBinding = {
  entityId?: string;
  matchTokens?: string[];
  switchEntityIds?: string[];
  temperatureEntityIds?: string[];
  humidityEntityIds?: string[];
  dryTargetHumidityPct?: number;
};

/**
 * The panels that can hold a slot.
 *
 * Quick Access was the first (specs/control-modules.md); every other dashboard
 * panel followed on 2026-09-25 (Adeline: "every panel that isn't an existing
 * modular control can default to a single modular slot, with the current content
 * as a module inside of it, so no visible change, but still have the ability to
 * reassign the content"). Each panel defaults to one slot holding a
 * `panel-content` preset, and a panel with several slots is laid out by the same
 * grid rule Quick Access uses.
 *
 * `zone-panel` is every zone's control panel: its slots apply whatever zone is
 * selected, and the panel supplies that zone's own content.
 */
export const CONTROL_SLOT_SURFACES = [
  "quick-access",
  "clock",
  "reminders",
  "zones",
  "zone-panel",
  "tasks",
] as const;

export type ControlSlotSurface = (typeof CONTROL_SLOT_SURFACES)[number];

/** A place on a dashboard surface that holds a preset. */
export type ControlSlot = {
  id: string;
  surface: ControlSlotSurface;
  presetId: string;
  /** The room this slot is placed in; a preset may inherit it. */
  roomId: string | null;
  /** Off hides the slot without losing its preset or its order. */
  visible: boolean;
};

/** The stored configuration block: `dashboard.controls`. */
export type ControlsConfig = {
  /**
   * True once the owner has saved this block at all — including to nothing.
   *
   * Without it "no presets stored" and "configured to show no controls" are the
   * same value, so deleting the last preset silently brought all five derived
   * controls back and the card could not be deliberately emptied. Absent means
   * not configured yet, which is the derivation.
   */
  configured?: boolean;
  presets: ControlPreset[];
  slots: ControlSlot[];
};

/**
 * A reason a preset cannot be used, in the owner's terms.
 *
 * `error` is structural — the preset names a module this build does not have, or
 * two presets share an id — and the save is refused, because nothing can render
 * it. `warning` is a setting that is legal to leave empty while it is being
 * filled in; it is reported in the Devices list and the save still lands, so a
 * half-built preset is not a reason to lose the other five.
 */
export type PresetProblem = {
  presetId: string;
  field: ControlModuleFieldId | "moduleId" | "driverId" | "variant" | "roomId" | "id";
  message: string;
  severity: "error" | "warning";
};

/**
 * A preset bound to its slot and resolved against the live zones. This is what
 * a surface renders: it has already decided which room it serves.
 */
export type ResolvedSlot = {
  slot: ControlSlot;
  preset: ControlPreset;
  module: ControlModule;
  driver: ControlModule | null;
  /** The room the slot serves: the preset's own, or the slot's when inheriting. */
  roomId: string | null;
  /** True when the room came from the slot rather than the preset. */
  roomInherited: boolean;
};
