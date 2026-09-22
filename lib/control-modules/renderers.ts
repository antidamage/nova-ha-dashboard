import type { ControlRendererId } from "./types";

/**
 * The shipped renderers and the behaviour vocabulary (specs/control-modules.md).
 *
 * A control module names a renderer — the thing that draws it. A control module
 * LINKS INTO behaviours and a driver module PROVIDES them, which is what makes a
 * control portable: it carries the list of what it depends on, so another
 * household can see what it has to supply before it places one.
 *
 * Every behaviour id names machinery that already exists in this codebase, so
 * the list describes behaviour rather than promising it.
 */

export const CONTROL_RENDERERS: Record<ControlRendererId, { label: string; detail: string }> = {
  "climate-knob": { label: "Temperature knob", detail: "The room's target, reading and mode on one dial" },
  "lighting-dial": { label: "Lighting dial", detail: "A room's colour and brightness, with its presets beside it" },
  "amplifier-dial": { label: "Amplifier dial", detail: "Volume, mute and the playlists under it" },
  "weather-readings": { label: "Weather readings", detail: "Condition, temperature, feels-like and UV" },
};

export const CONTROL_BEHAVIOURS: Record<string, { label: string; detail: string }> = {
  "power-intent-hold": { label: "Power-intent hold", detail: "A press keeps the chosen state until the unit answers, so a slow unit cannot snap the knob back" },
  "auto-arming": { label: "Auto arming", detail: "Auto waits for a real gap between the target and the room before it starts heating or cooling" },
  "dry-emulation": { label: "Dry emulation", detail: "A unit with no dry mode is driven toward a humidity target by hand" },
  "fan-control": { label: "Fan control", detail: "Fan steps are set on the unit, not only displayed" },
  "quiet-turbo-fresh-air": { label: "Quiet, Turbo and Fresh air", detail: "The unit's auxiliary switches are part of the control" },
  "off-timer": { label: "Off timer", detail: "The unit or the household's own timer stops it after a chosen delay" },
  "server-truth-thermostat": { label: "Server-truth thermostat", detail: "The displayed mode and target come from the server, so every surface agrees" },
  "grouped-room-sensors": { label: "Grouped room sensors", detail: "Ordered sensor lists: the room's own reading leads, a damped onboard one trails" },
  "last-request-wins": { label: "Last request wins", detail: "Two quick taps resolve to the later one, never to whichever reply landed last" },
  "debounced-target-save": { label: "Debounced target save", detail: "A dragged target is written once, after the drag" },
  "appliance-safety-limit": { label: "Appliance safety limit", detail: "The target is clamped to the range the appliance can actually hold" },
  "zone-lighting-presets": { label: "Zone lighting presets", detail: "The room's own named presets, applied server-side with every rule they carry" },
  "adaptive-candlelight": { label: "Adaptive Candlelight", detail: "Colour and brightness follow the sun, so the same button is warmer after dark" },
  "per-light-overrides": { label: "Per-light overrides", detail: "Pinned lights, per-entity brightness and colour-temperature overrides" },
  "night-rules": { label: "Night rules", detail: "Sun-below-horizon colour and brightness rules apply without being re-implemented" },
};

export function behaviourLabel(id: string): { label: string; detail: string } {
  return CONTROL_BEHAVIOURS[id] ?? { label: id, detail: "" };
}
