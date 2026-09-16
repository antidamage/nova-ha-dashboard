// Which light sound a command earns, if any.
//
// Only the crossing counts: a light going fully off, or coming on from fully
// off. Changing colour or nudging brightness between two lit values is silent,
// and so is a command that leaves the lights where they already were. One
// sound per command, however many lights it covers.
//
// The surface that issued the command plays it locally — there is no server
// attribution, so a physical switch, voice or an HA automation is silent
// everywhere. See specs/ux-sounds.md, "Lights on and off".

import type { EntityActionInput } from "../../../lib/aircon-control";
import type { DashboardState } from "../../../lib/types";
import type { UxSoundAction } from "./uxSoundActions";

export type LightSound = Extract<UxSoundAction, "lightsOn" | "lightsOff">;

/** Brightness is the on/off axis (specs/zone-light-events.md). */
function isLit(state: DashboardState | null, entityId: string): boolean {
  const entity = state?.entities.find((candidate) => candidate.entity_id === entityId);
  if (!entity || entity.state !== "on") {
    return false;
  }
  const brightness = (entity.attributes as { brightness?: unknown } | undefined)?.brightness;
  return typeof brightness === "number" ? brightness > 0 : true;
}

/** What a single action leaves the light as, or null when it does not decide. */
function commandedState(action: EntityActionInput): "on" | "off" | null {
  if (action.domain !== "light") {
    return null;
  }
  if (action.service === "turn_off") {
    return "off";
  }
  if (action.service !== "turn_on") {
    return null;
  }
  const brightness = action.data?.brightness_pct ?? action.data?.brightness;
  if (typeof brightness === "number") {
    return brightness > 0 ? "on" : "off";
  }
  return "on";
}

function decide(transitions: readonly ("on" | "off")[]): LightSound | null {
  if (transitions.includes("on")) {
    return "lightsOn";
  }
  return transitions.includes("off") ? "lightsOff" : null;
}

export function lightSoundForEntityActions(
  actions: readonly EntityActionInput[],
  state: DashboardState | null,
): LightSound | null {
  const transitions: ("on" | "off")[] = [];
  for (const action of actions) {
    const commanded = commandedState(action);
    if (!commanded) {
      continue;
    }
    const wasLit = isLit(state, action.entityId);
    if (commanded === "on" && !wasLit) {
      transitions.push("on");
    } else if (commanded === "off" && wasLit) {
      transitions.push("off");
    }
  }
  return decide(transitions);
}

export function lightSoundForZoneAction(
  zoneId: string,
  action: string,
  state: DashboardState | null,
): LightSound | null {
  if (action !== "on" && action !== "off") {
    return null;
  }

  // The zone owns its entity list; the dashboard has no zone id on an entity.
  const zone = state?.zones.find((candidate) => candidate.id === zoneId);
  const lights = (zone?.entities ?? []).filter((entity) => entity.domain === "light");
  if (lights.length === 0) {
    return null;
  }

  const transitions: ("on" | "off")[] = [];
  for (const light of lights) {
    const wasLit = isLit(state, light.entity_id);
    if (action === "on" && !wasLit) {
      transitions.push("on");
    } else if (action === "off" && wasLit) {
      transitions.push("off");
    }
  }
  return decide(transitions);
}
