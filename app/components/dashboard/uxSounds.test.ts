import { describe, expect, it } from "vitest";
import { lightSoundForEntityActions, lightSoundForZoneAction } from "./lightSoundTransition";
import {
  BUTTON_PRESS_SOUND,
  DEFAULT_UX_SOUNDS,
  normalizeUxSounds,
  REMINDER_AUDIO_SOUND,
  TIMER_CHIME_SOUND,
  UX_SOUND_ACTIONS,
} from "./uxSoundActions";
import type { DashboardState } from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";

describe("ux sound assignments", () => {
  it("fills a theme saved before the feature with the full default map", () => {
    const filled = normalizeUxSounds(undefined);
    expect(Object.keys(filled).sort()).toEqual([...UX_SOUND_ACTIONS].sort());
    expect(filled.buttonPress).toBe(BUTTON_PRESS_SOUND);
    // The two actions that already had a deliberate sound keep it.
    expect(filled.timerAlert).toBe(TIMER_CHIME_SOUND);
    expect(filled.reminderAlert).toBe(REMINDER_AUDIO_SOUND);
  });

  it("keeps explicit assignments, including None, and drops unknown keys", () => {
    const filled = normalizeUxSounds({ dialClick: "medium-ratchet", foldBreak: null, nonsense: "x" });
    expect(filled.dialClick).toBe("medium-ratchet");
    expect(filled.foldBreak).toBeNull();
    expect(filled.sectionChange).toBe(DEFAULT_UX_SOUNDS.sectionChange);
    expect("nonsense" in filled).toBe(false);
  });

  it("ignores a blank or non-string assignment rather than silencing the action", () => {
    const filled = normalizeUxSounds({ buttonPress: "   ", dialClick: 7 });
    expect(filled.buttonPress).toBe(BUTTON_PRESS_SOUND);
    expect(filled.dialClick).toBe(BUTTON_PRESS_SOUND);
  });
});

function entity(id: string, state: string, brightness?: number) {
  return {
    entity_id: id,
    domain: "light",
    state,
    name: id,
    area_id: "lounge",
    attributes: brightness === undefined ? {} : { brightness },
  };
}

function stateWith(entities: ReturnType<typeof entity>[], zoneEntities = entities): DashboardState {
  return {
    entities,
    zones: [{ id: "lounge", name: "Lounge", entities: zoneEntities }],
  } as unknown as DashboardState;
}

const action = (service: string, data?: Record<string, unknown>): EntityActionInput =>
  ({ entityId: "light.lamp", domain: "light", service, data }) as EntityActionInput;

describe("light on/off transitions", () => {
  it("sounds only when the command crosses the on/off boundary", () => {
    const lit = stateWith([entity("light.lamp", "on", 180)]);
    const dark = stateWith([entity("light.lamp", "off")]);

    expect(lightSoundForEntityActions([action("turn_off")], lit)).toBe("lightsOff");
    expect(lightSoundForEntityActions([action("turn_on")], dark)).toBe("lightsOn");
    // Already there: no crossing, no sound.
    expect(lightSoundForEntityActions([action("turn_off")], dark)).toBeNull();
    expect(lightSoundForEntityActions([action("turn_on")], lit)).toBeNull();
  });

  it("treats brightness zero as off and a colour change as neither", () => {
    const lit = stateWith([entity("light.lamp", "on", 180)]);
    expect(lightSoundForEntityActions([action("turn_on", { brightness_pct: 0 })], lit)).toBe("lightsOff");
    expect(lightSoundForEntityActions([action("turn_on", { brightness_pct: 40 })], lit)).toBeNull();
    expect(lightSoundForEntityActions([action("turn_on", { rgb_color: [255, 0, 0] })], lit)).toBeNull();
  });

  it("ignores anything that is not a light", () => {
    const lit = stateWith([entity("light.lamp", "on", 180)]);
    const heater = { entityId: "climate.heater", domain: "climate", service: "turn_off" } as EntityActionInput;
    expect(lightSoundForEntityActions([heater], lit)).toBeNull();
  });

  it("sounds once for a zone command however many lights it covers", () => {
    const mixed = stateWith([entity("light.a", "on", 200), entity("light.b", "off")]);
    expect(lightSoundForZoneAction("lounge", "off", mixed)).toBe("lightsOff");
    expect(lightSoundForZoneAction("lounge", "on", mixed)).toBe("lightsOn");
    // Brightness and colour zone actions never cross the boundary.
    expect(lightSoundForZoneAction("lounge", "brightness", mixed)).toBeNull();

    const allDark = stateWith([entity("light.a", "off"), entity("light.b", "off")]);
    expect(lightSoundForZoneAction("lounge", "off", allDark)).toBeNull();
    expect(lightSoundForZoneAction("lounge", "on", allDark)).toBe("lightsOn");
  });

  it("is silent for a zone it cannot find", () => {
    expect(lightSoundForZoneAction("kitchen", "off", stateWith([entity("light.a", "on", 10)]))).toBeNull();
  });
});
