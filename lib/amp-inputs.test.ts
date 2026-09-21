import { describe, expect, it } from "vitest";
import { combinedAmpDesired, desiredFromAudioOutput, desiredFromSource, desiredFromStates, switchStateOf } from "./amp-inputs";
import type { AmpPowerControlConfig } from "./config-schema";
import type { HaState } from "./types";

function statesOf(entries: Record<string, string>) {
  return new Map<string, HaState>(
    Object.entries(entries).map(([entity_id, state]) => [entity_id, { entity_id, state, attributes: {} }]),
  );
}

describe("desiredFromSource", () => {
  it("reads the configured off-states as off", () => {
    expect(desiredFromSource("off", ["off", "standby"])).toBe("off");
    expect(desiredFromSource("standby", ["off", "standby"])).toBe("off");
  });

  it("treats every other live state as on, including idle and paused", () => {
    // Adeline's choice: powered on, not playing. A pause must not cut the amp
    // mid-film (specs/amp-appletv-power.md §1.1).
    for (const state of ["idle", "playing", "paused", "buffering", "on"]) {
      expect(desiredFromSource(state, ["off", "standby"])).toBe("on");
    }
  });

  it("has no opinion when the Apple TV cannot be seen", () => {
    expect(desiredFromSource("unavailable", ["off"])).toBeNull();
    expect(desiredFromSource("unknown", ["off"])).toBeNull();
    expect(desiredFromSource(undefined, ["off"])).toBeNull();
  });
});

describe("switchStateOf", () => {
  const ids = ["switch.tuya_mobile_floating_meter", "switch.floating_meter"];

  it("reads the plug through whichever twin Home Assistant has", () => {
    expect(switchStateOf(ids, statesOf({ "switch.floating_meter": "off" }))).toBe("off");
    expect(switchStateOf(ids, statesOf({ "switch.tuya_mobile_floating_meter": "on" }))).toBe("on");
  });

  it("is null when no twin can be read", () => {
    expect(switchStateOf(ids, statesOf({}))).toBeNull();
    expect(switchStateOf(ids, statesOf({ "switch.floating_meter": "unavailable" }))).toBeNull();
  });

  it("takes any twin reading on as the socket being on", () => {
    expect(
      switchStateOf(ids, statesOf({ "switch.floating_meter": "off", "switch.tuya_mobile_floating_meter": "on" })),
    ).toBe("on");
  });
});

describe("desiredFromAudioOutput", () => {
  const config = { offStates: ["off"], onStates: ["on"] };

  it("keeps the amp on while the Apple TV plays through the TV's speakers", () => {
    expect(desiredFromAudioOutput("on", config)).toBe("on");
  });

  it("switches the amp off when the audio has gone somewhere else", () => {
    // Bluetooth headphones: the use case Adeline named (§8).
    expect(desiredFromAudioOutput("off", config)).toBe("off");
  });

  it("has no opinion when the bridge cannot be read", () => {
    // A dead bridge must not be able to silence the amplifier (§8.3).
    for (const state of ["unavailable", "unknown", "", undefined]) {
      expect(desiredFromAudioOutput(state, config)).toBeNull();
    }
  });

  it("cannot be talked into reading a dead bridge as off", () => {
    // §8.3 is a property of this code, not of the shipped offStates: naming
    // "unavailable" there is not a way to make an unreadable bridge switch the
    // amplifier off.
    const hostile = { offStates: ["off", "unavailable", "unknown"], onStates: ["on"] };
    for (const state of ["unavailable", "unknown", ""]) {
      expect(desiredFromAudioOutput(state, hostile)).toBeNull();
    }
  });

  it("resolves a state both lists name to on", () => {
    // The safe direction when a household edits the two lists into an overlap.
    expect(desiredFromAudioOutput("on", { offStates: ["on"], onStates: ["on"] })).toBe("on");
  });

  it("has no opinion about a state nobody classified", () => {
    expect(desiredFromAudioOutput("TV Speakers", config)).toBeNull();
  });
});

describe("combinedAmpDesired", () => {
  it("lets a sleeping Apple TV decide alone", () => {
    expect(combinedAmpDesired("off", "on")).toBe("off");
    expect(combinedAmpDesired("off", null)).toBe("off");
  });

  it("lets the audio route overrule the power state while it is awake", () => {
    expect(combinedAmpDesired("on", "off")).toBe("off");
    expect(combinedAmpDesired("on", "on")).toBe("on");
  });

  it("keeps the amp on when the route cannot be read", () => {
    // The behaviour this house had before the route was consulted at all.
    expect(combinedAmpDesired("on", null)).toBe("on");
  });

  it("has nothing to say when the Apple TV itself cannot be seen", () => {
    expect(combinedAmpDesired(null, "off")).toBeNull();
  });
});

describe("desiredFromStates", () => {
  const config: AmpPowerControlConfig = {
    audioOutput: {
      entityId: "binary_sensor.home_theatre_tv_speakers",
      offStates: ["off"],
      onStates: ["on"],
    },
    categoryId: "amp",
    minIntervalSeconds: 30,
    offStates: ["off", "standby"],
    pollIntervalSeconds: 5,
    sourceEntityId: "media_player.home_theatre",
    staleRestoreSeconds: 600,
    switchEntityIds: ["switch.floating_meter"],
  };

  it("needs both: awake, and playing through the TV's speakers", () => {
    expect(
      desiredFromStates(
        config,
        statesOf({
          "binary_sensor.home_theatre_tv_speakers": "on",
          "media_player.home_theatre": "playing",
        }),
      ),
    ).toBe("on");
  });

  it("switches the amp off when the Apple TV is awake and the audio has gone elsewhere", () => {
    expect(
      desiredFromStates(
        config,
        statesOf({
          "binary_sensor.home_theatre_tv_speakers": "off",
          "media_player.home_theatre": "playing",
        }),
      ),
    ).toBe("off");
  });

  it("switches the amp off while the Apple TV sleeps, whatever the route says", () => {
    expect(
      desiredFromStates(
        config,
        statesOf({
          "binary_sensor.home_theatre_tv_speakers": "on",
          "media_player.home_theatre": "off",
        }),
      ),
    ).toBe("off");
  });

  it("ignores the route entirely when no bridge is configured", () => {
    // A generic install carries this code and neither the entity nor the
    // behaviour (§8.1).
    const { audioOutput: _noBridge, ...withoutBridge } = config;
    expect(desiredFromStates(withoutBridge, statesOf({ "media_player.home_theatre": "playing" }))).toBe("on");
  });
});
