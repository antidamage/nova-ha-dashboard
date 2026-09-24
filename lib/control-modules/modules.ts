import {
  FIELD_DRY_HUMIDITY,
  FIELD_ENTITY,
  FIELD_HUMIDITY_IDS,
  FIELD_MATCH_TOKENS,
  FIELD_SWITCH_IDS,
  FIELD_TEMPERATURE_IDS,
} from "./fields";
import type { ControlModule } from "./types";

/**
 * The shipped module catalogue (specs/control-modules.md) — the DATA.
 *
 * Every value is generic: no entity id, area name or hostname appears in this
 * file. A module declares what it needs; a preset supplies this installation's
 * answers. Enforced by `lib/no-household-data.test.ts`.
 *
 * The lookups over this list live in `catalogue.ts`, which re-exports it, so a
 * call site never depends on which of the two it came from.
 */

const CLIMATE_DRIVERS = ["gree-air-conditioner", "sample-heater-wifi-switch"];

export const CONTROL_MODULES: readonly ControlModule[] = [
  {
    id: "aircon-heater-control",
    name: "Air Conditioner / Heater",
    summary: "A room's temperature knob — cooling, heating or both",
    detail:
      "One control for a room's climate, configured to be an air conditioner or a heater and to run on the driver that matches the hardware. Its behaviours come from the driver it is assigned, so pointing the same knob at a different make of unit changes nothing else on the dashboard.",
    category: "Climate",
    layer: "control",
    renderer: "climate-knob",
    region: "climate",
    variants: [
      { id: "aircon", label: "Air conditioner", detail: "Auto, Manual and Off, with mode, fan and timer rings" },
      { id: "heater", label: "Heater", detail: "Auto and Off, with the household's timer ring" },
    ],
    behaviours: [
      "power-intent-hold",
      "auto-arming",
      "dry-emulation",
      "fan-control",
      "quiet-turbo-fresh-air",
      "off-timer",
      "server-truth-thermostat",
      "grouped-room-sensors",
      "last-request-wins",
      "debounced-target-save",
      "appliance-safety-limit",
    ],
    /**
     * Features switch something off; behaviours (above) are what the control
     * links into and are described rather than toggled. Auto arming and Dry
     * emulation are decided server-side from the unit's own capabilities, so
     * they are behaviours and deliberately not features here.
     */
    features: [
      { id: "fan-ring", label: "Fan ring", detail: "Show the fan step ring", default: true, variantIds: ["aircon"] },
      { id: "off-timer", label: "Off timer", detail: "Show the timer ring", default: true },
      { id: "quiet-turbo-fresh-air", label: "Quiet / Turbo / Fresh air", detail: "Include the unit's auxiliary switches", default: true, driverIds: ["gree-air-conditioner"] },
      { id: "grouped-room-sensors", label: "Grouped room sensors", detail: "Read the room from its own sensor list", default: true, driverIds: ["sample-heater-wifi-switch"] },
      { id: "humidity-readout", label: "Humidity readout", detail: "Include the room's humidity in the knob's label", default: true, driverIds: ["sample-heater-wifi-switch"] },
    ],
    /**
     * No fields of its own: an air conditioner's entities and a heater's switch
     * list are different questions, and the driver is what knows which one
     * applies. The editor shows the control's fields plus the assigned driver's,
     * so a control that bound hardware itself could still do so.
     */
    fields: [],
    driverIds: CLIMATE_DRIVERS,
    driverFor: null,
    placeable: true,
  },
  {
    id: "gree-air-conditioner",
    name: "Gree Air Conditioner",
    summary: "Driver: a Gree indoor unit, named after its maker",
    detail:
      "Drives one Gree indoor unit: Auto, Manual and Off, the unit's fan steps, its Quiet / Turbo / Fresh-air switches and the household's off timer. Assign it to any climate device — it is bound to the unit, not to the room the unit happens to stand in. A unit with no native dry mode is offered Dry through Nova's own humidity-driven emulation.",
    category: "Climate",
    layer: "driver",
    renderer: null,
    region: null,
    variants: [],
    behaviours: ["power-intent-hold", "auto-arming", "dry-emulation", "fan-control", "quiet-turbo-fresh-air", "off-timer"],
    features: [],
    fields: [FIELD_ENTITY, FIELD_MATCH_TOKENS, FIELD_TEMPERATURE_IDS, FIELD_HUMIDITY_IDS, FIELD_DRY_HUMIDITY],
    driverIds: [],
    driverFor: { renderer: "climate-knob", variant: "aircon" },
    placeable: false,
  },
  {
    id: "sample-heater-wifi-switch",
    name: "Sample Heater WiFi Switch",
    summary: "Driver: a smart switch plus the room's own sensors",
    detail:
      "Controls a heating element behind a plain smart switch, with the thermostat loop on this server rather than in the device. This is the sample driver to copy when a room has a switch and a sensor rather than a climate entity: the switch list and the temperature list are both ordered, and that ordering is a safety property — the room's own reading leads, and a sensor that reads its own switch body trails it.",
    category: "Heating",
    layer: "driver",
    renderer: null,
    region: null,
    variants: [],
    behaviours: [
      "server-truth-thermostat",
      "grouped-room-sensors",
      "last-request-wins",
      "debounced-target-save",
      "appliance-safety-limit",
      "off-timer",
    ],
    features: [],
    fields: [FIELD_SWITCH_IDS, FIELD_TEMPERATURE_IDS, FIELD_HUMIDITY_IDS],
    driverIds: [],
    driverFor: { renderer: "climate-knob", variant: "heater" },
    placeable: false,
  },
  {
    id: "room-lighting",
    name: "Room Lighting",
    summary: "A room's lights: colour, brightness and its presets",
    detail:
      "The basics for any room: one dial for colour and brightness and the room's own preset buttons beside it. It sends the same actions the room's own panel sends, so per-light overrides, the night-time rules and the adaptive Candlelight label all apply unchanged wherever it is placed.",
    category: "Lighting",
    layer: "control",
    renderer: "lighting-dial",
    region: "dial-line",
    variants: [],
    behaviours: ["zone-lighting-presets", "adaptive-candlelight", "per-light-overrides", "night-rules"],
    features: [
      { id: "preset-buttons", label: "Preset buttons", detail: "Show the room's named presets beside the dial", default: true },
    ],
    /**
     * No binding: a lighting preset's device IS the room it serves, so the room
     * picker in the editor is the whole configuration.
     */
    fields: [],
    driverIds: [],
    driverFor: null,
    placeable: true,
  },
  {
    id: "amplifier-control",
    name: "Amplifier",
    summary: "A room's audio: volume, mute and its playlists",
    detail:
      "The household's amplifier dial — one knob for volume and mute, with the playlist buttons under it. The dial is the placeholder for the IR emitter that will drive the amp: it turns and its lights toggle mute, and nothing is sent yet. That is exactly why it is a module: a home without an amplifier simply does not place it, and a home with two places two.",
    category: "Media",
    layer: "control",
    renderer: "amplifier-dial",
    region: "dial-line",
    variants: [],
    behaviours: [],
    features: [],
    fields: [],
    driverIds: [],
    driverFor: null,
    placeable: true,
  },
  {
    id: "panel-content",
    name: "Panel's own content",
    summary: "Whatever a panel shows by default",
    detail:
      "A panel is a place content is shown, and this is the content it came with: the clock, the room menu, the zone's controls, the metering, the task list. Every panel defaults to one slot holding this, so a dashboard that has never been configured looks exactly as it did — and because that slot is a slot like any other, the content can be reassigned, moved, or taken off the panel without losing it.",
    category: "Panels",
    layer: "control",
    renderer: "panel-content",
    region: null,
    variants: [],
    behaviours: [],
    features: [],
    fields: [],
    driverIds: [],
    driverFor: null,
    placeable: true,
  },
  {
    id: "outside-weather",
    name: "Outside Weather",
    summary: "The outside condition and its readings",
    detail:
      "The weather the house is standing in, read from the configured weather entity. It has no device of its own to bind and nothing to assign, which is exactly why it is a module: a home that does not want it simply does not place it.",
    category: "Environment",
    layer: "control",
    renderer: "weather-readings",
    region: "readings",
    variants: [],
    behaviours: [],
    features: [
      { id: "feels-like", label: "Feels like", detail: "Include the apparent temperature", default: true },
      { id: "uv", label: "UV index", detail: "Include the UV reading", default: true },
    ],
    fields: [],
    driverIds: [],
    driverFor: null,
    placeable: true,
  },
];
