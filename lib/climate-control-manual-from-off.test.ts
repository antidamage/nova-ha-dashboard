import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  hvacCalls,
  loadController,
  lounge,
  offCalls,
  pressCardFanStep,
  pressCardManual,
  pressManual,
  resetWorld,
  settle,
  setWorld,
  world,
} from "./climate-control-world.fixtures";

vi.mock("./preferences", async () => (await import("./climate-control-world.fixtures")).preferencesMock());
vi.mock("./ha/client", async () => (await import("./climate-control-world.fixtures")).haClientMock());
vi.mock("./dashboard-config", async () => (await import("./climate-control-world.fixtures")).dashboardConfigMock());
vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T08:00:00Z"));
  resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21 } });
});

afterEach(() => {
  vi.useRealTimers();
});

/*
 * The 2026-09-24 incident, from the lounge Gree's own history: the unit off, the
 * room 21, the target 27, and the card's press sent `set_hvac_mode: cool`
 * followed 41 ms later by `turn_off` — twice per press, for three presses. The
 * unit beeped and never ran, and the Manual she had selected went out on its own.
 *
 * Both halves of it are here: the remembered direction is not evidence for what
 * the room needs, and nothing but the mode switch may unset the mode.
 */
describe("Manual selected from Off with the room away from its target", () => {
  test("the room decides the direction, not the remembered one", async () => {
    // Nova's own Auto leg had written hvacMode: cool that day, from the Gree's
    // heat-soaked thermistor reading above the target while the unit was off.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 27 } });
    const control = await loadController();
    world.calls.length = 0;

    setWorld({ acState: "off", roomTemperature: 21, quiet: "off" });
    await pressCardManual(control, { direction: "cool", temperature: 27 });
    await settle(control);

    // The card's own command is the stale one; the loop's answer is the room's.
    expect(hvacCalls("cool")).toHaveLength(1);
    expect(hvacCalls("heat")).toHaveLength(1);
    expect(offCalls()).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.direction).toBe("heat");
  });

  test("the press's own quiet-switch housekeeping does not unset Manual", async () => {
    setWorld({ acState: "off", roomTemperature: 21, quiet: "off" });
    const control = await loadController();
    await pressCardManual(control, { direction: "heat", temperature: 27 });
    await settle(control);

    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).not.toBe("off");
  });

  test("choosing a fan step by hand leaves Auto for Manual, never Off", async () => {
    // The knob's fan ring sends `remember: { autoMode: false, ... }` and that
    // remember rides the LAST action of the press — the quiet switch's turn_off
    // when the unit is already on that fan mode. Reading it as Off unset the mode
    // on an ordinary knob press (2026-09-24 review).
    resetWorld({ aircon: { autoMode: true, hvacMode: "heat", temperature: 21 } });
    setWorld({ acState: "heat", roomTemperature: 21, quiet: "on" });
    const control = await loadController();
    await pressCardFanStep(control);
    await settle(control);

    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).not.toBe("off");
  });

  test("a remembered direction does not decide for the room", async () => {
    // `prefs.hvacMode` is what Nova's own Auto leg writes, so it is not evidence.
    // A room a degree under its target with "cool" remembered must still read heat
    // — reading the remembered value as the dictation held the direction for a full
    // degree past the target (2026-09-24 review).
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 27 } });
    setWorld({ acState: "heat", roomTemperature: 26, quiet: "off" });
    const control = await loadController();
    await settle(control);
    world.calls.length = 0;
    await settle(control);

    expect(offCalls()).toHaveLength(0);
    expect(hvacCalls("cool")).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.direction).toBe("heat");
  });

  test("with no reading and nothing seated the loop does not guess a direction", async () => {
    // §5.2: a blind start runs "only the direction she chose or the one already
    // running, never a guess between heat and cool". Nothing seated and no reading
    // is neither, so nothing is sent — the remembered direction is not a guess the
    // loop is allowed to make.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 27 } });
    setWorld({ acState: "off", roomTemperature: 26, sensorAgeMinutes: 45 });
    const control = await loadController();
    await control.handleLegacyClimateAction({
      entityId: "climate.ac", domain: "climate", service: "turn_on",
    });
    world.calls.length = 0;
    await settle(control);

    expect(hvacCalls("cool")).toHaveLength(0);
    expect(hvacCalls("heat")).toHaveLength(0);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("a selected mode is never inert: off plus a room away from target always drives", async () => {
    const cases = [
      { room: 21, at: "2026-09-19T08:00:00Z", expected: "heat" as const },
      { room: 30, at: "2026-09-19T09:00:00Z", expected: "cool" as const },
    ];

    for (const { room: roomTemperature, at, expected } of cases) {
      vi.setSystemTime(new Date(at));
      resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 27 } });
      const control = await loadController();
      setWorld({ acState: "off", roomTemperature });
      await pressManual(control);
      await settle(control);
      world.calls.length = 0;

      // Past the compressor dwell and the sensor-settling hold, the room still
      // where it was.
      vi.setSystemTime(new Date(new Date(at).getTime() + 45 * 60_000));
      setWorld({ acState: "off", roomTemperature });
      await settle(control);
      await settle(control);

      expect(hvacCalls(expected), `a ${roomTemperature} degree room with a 27 degree target`).toHaveLength(1);
      const room = await lounge(control);
      expect(room.mode).toBe("manual");
      expect(room.direction).toBe(expected);
    }
  });
});

