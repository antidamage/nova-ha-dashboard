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
 * Both halves of it are here: the card names the direction the room needs rather
 * than a remembered one, and nothing but the mode switch may unset the mode.
 */
describe("Manual selected from Off with the room away from its target", () => {
  test("the press names the direction the room needs, and the loop drives it", async () => {
    // Nova's own Auto leg had written hvacMode: cool that day, from the Gree's
    // heat-soaked thermistor reading above the target while the unit was off. The
    // card derives the direction from the room before it sends anything
    // (useAirconCommands.setOn), so the remembered value never reaches the unit —
    // and the seat the press lands is the room's answer, not a stale one.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 27 } });
    const control = await loadController();
    world.calls.length = 0;

    setWorld({ acState: "off", roomTemperature: 21, quiet: "off" });
    await pressCardManual(control, { direction: "heat", temperature: 27 });
    await settle(control);

    // The card's own command and the loop's answer name the same direction.
    expect(hvacCalls("heat")).toHaveLength(2);
    expect(hvacCalls("cool")).toHaveLength(0);
    expect(offCalls()).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.direction).toBe("heat");
  });

  test("a seated direction is not reversed when the room sits past the target", async () => {
    // 2026-09-25, her report: heat seated, the target 21 in a 25 degree room.
    // "I'm happy to wait for it to get there on its own" — the mode is what holds
    // the room once it arrives there, so the loop must not read the room as
    // wanting cooling and reverse her.
    resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21 } });
    setWorld({ acState: "off", roomTemperature: 25, quiet: "off" });
    const control = await loadController();
    await pressManual(control, "heat");
    await settle(control);
    world.calls.length = 0;
    await settle(control);
    await settle(control);

    expect(hvacCalls("cool")).toHaveLength(0);
    expect(offCalls()).toHaveLength(0);
    expect((await lounge(control)).direction).toBe("heat");
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

  test("with nothing seated the loop drives the room's own direction", async () => {
    // `turn_on` selects Manual without naming a direction, so nothing is seated and
    // the room is the only thing that can answer (manual-direction-model.ts). The
    // card derives the same direction before it sends anything; this is the loop's
    // half of that, against a unit that is off.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 27 } });
    setWorld({ acState: "off", roomTemperature: 21, quiet: "off" });
    const control = await loadController();
    await control.handleLegacyClimateAction({
      entityId: "climate.ac", domain: "climate", service: "turn_on",
    });
    await settle(control);

    expect(hvacCalls("heat")).toHaveLength(1);
    expect(hvacCalls("cool")).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.direction).toBe("heat");
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
      // The seat is the direction the room needs: heat below the target, cool
      // above it. What the seat is NOT is a thing the loop may reverse — that is
      // the case the loop's own tick has to leave alone (see the reversal test
      // above), and it is why a wrong seat is the owner's to fix, not Nova's.
      await pressManual(control, expected);
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

