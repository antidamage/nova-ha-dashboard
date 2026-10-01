/**
 * The sleep timer is the owner's own instruction, and it survives a suspension.
 *
 * A room is suspended (`owner: "external"`) the moment its unit changes under a
 * hand other than Nova's, and while it is suspended the loop does not drive the
 * unit at all. The sleep timer used to be evaluated inside that ownership-guarded
 * block, so a timer armed before the unit was taken by hand was never read again:
 * the room ran past its timer and stayed on all night (reported 2026-10-02 — an
 * aircon left in Manual). Both drivers now read the timer before the ownership
 * guard, because an expired timer is the owner's own instruction and it can only
 * ever turn a unit off.
 *
 * See `specs/aircon-auto-control.md` (Sleep timer) and
 * `specs/bedroom-heater-control-integrity.md` §8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Controller,
  type Json,
  dashboardConfigMock,
  haClientMock,
  loadController,
  lounge,
  merge,
  offCalls,
  preferencesMock,
  pressManual,
  resetWorld,
  settle,
  setWorld,
  world,
} from "./climate-control-world.fixtures";

vi.mock("./preferences", async () => (await import("./climate-control-world.fixtures")).preferencesMock());
vi.mock("./ha/client", async () => (await import("./climate-control-world.fixtures")).haClientMock());
vi.mock("./dashboard-config", async () =>
  (await import("./climate-control-world.fixtures")).dashboardConfigMock({ heater: true }));

const bedroom = async (control: Controller) => (await control.climateControlState()).bedroom;
const heaterCalls = (service: string) =>
  world.calls.filter((call) => call.service === service && JSON.stringify(call.data).includes("switch.bedroom_heater"));

async function suspendTheAircon(control: Controller) {
  await pressManual(control);
  setWorld({ acState: "heat", roomTemperature: 18 });
  await settle(control);
  // Out at the unit, well past the 12-second command settle window: the unit is
  // hers now and the loop stands down.
  vi.setSystemTime(new Date("2026-09-19T08:20:00.000Z"));
  setWorld({ acState: "cool", roomTemperature: 18 });
  await settle(control);
  expect((await lounge(control)).owner).toBe("external");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T08:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an aircon sleep timer", () => {
  it("turns the unit off when it expires after the room was taken by hand", async () => {
    resetWorld({});
    const control = await loadController();
    await suspendTheAircon(control);

    // The unit is running and a timer she set earlier has since passed.
    setWorld({ acState: "heat", roomTemperature: 18 });
    world.preferences = merge(world.preferences, { aircon: { offTimerEndsAt: "2026-09-19T08:30:00.000Z" } });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    const stopped = await lounge(control);
    expect(stopped.lastStopReason).toBe("timer-expired");
    // Both stay hers: Nova ran her timer, it did not take the room back.
    expect(stopped.owner).toBe("external");
    expect((world.preferences.aircon as Json | undefined)?.offTimerEndsAt ?? null).toBeNull();

    // The unit obeys the stop it was sent, and the card reads Off.
    setWorld({ acState: "off", roomTemperature: 18 });
    await settle(control);
    expect((await lounge(control)).mode).toBe("off");
  });

  it("leaves a suspended room alone when no timer was armed", async () => {
    resetWorld({});
    const control = await loadController();
    await suspendTheAircon(control);

    setWorld({ acState: "heat", roomTemperature: 18 });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(offCalls().length).toBe(0);
    expect((await lounge(control)).owner).toBe("external");
  });
});

describe("an aircon sleep timer, and the emulated-Dry bookkeeping", () => {
  const setpointCalls = () => world.calls.filter((call) => call.service === "set_temperature");

  /**
   * Leaving emulated Dry puts the owner's target back, because the emulated cool
   * cycle replaced it with room minus one (`drive-aircon.ts`). That restore is a
   * write, so it must not reach a unit a person has taken: the timer stops the
   * unit, and stopping it is all the timer does.
   *
   * Opening Dry by hand would need a unit without a native dry mode and a room
   * humidity sensor; the flag is what that path leaves behind, and the flag is
   * what the write is gated on.
   */
  it("stops a suspended unit without writing emulated Dry's setpoint back", async () => {
    resetWorld({});
    const control = await loadController();
    const { roomState } = await import("./climate-control/store");
    await suspendTheAircon(control);

    roomState("lounge").drySetpointChanged = true;
    setWorld({ acState: "heat", roomTemperature: 18 });
    world.preferences = merge(world.preferences, {
      aircon: { temperature: 21, offTimerEndsAt: "2026-09-19T08:30:00.000Z" },
    });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    // The write this change exists to prevent: Nova rewriting the setpoint of a
    // unit that is in someone else's hands, at the moment she stood down from it.
    expect(setpointCalls()).toEqual([]);
    expect((await lounge(control)).owner).toBe("external");
  });

  it("still puts the target back when the room is Nova's", async () => {
    // The control: same expired timer, same bookkeeping left by the cool cycle,
    // but nobody has taken the unit, so the restore is hers to make. Without
    // this the assertion above would pass on a loop that never restores at all.
    resetWorld({});
    const control = await loadController();
    const { roomState } = await import("./climate-control/store");
    // The unit is already doing what her own request says, so nothing about it
    // reads as someone else's hand.
    setWorld({ acState: "heat", roomTemperature: 18 });
    await pressManual(control);
    expect((await lounge(control)).owner).toBe("nova");

    roomState("lounge").drySetpointChanged = true;
    world.preferences = merge(world.preferences, {
      aircon: { temperature: 21, offTimerEndsAt: "2026-09-19T08:30:00.000Z" },
    });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    expect(setpointCalls().map((call) => call.data)).toEqual([{ entity_id: "climate.ac", temperature: 21 }]);
  });

  it("leaves a suspended room alone while its timer is still in the future", async () => {
    // The widened guard must not become "drive a suspended room": only an
    // expired timer opens it.
    resetWorld({});
    const control = await loadController();
    await suspendTheAircon(control);

    setWorld({ acState: "heat", roomTemperature: 18 });
    world.preferences = merge(world.preferences, { aircon: { offTimerEndsAt: "2026-09-19T10:00:00.000Z" } });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(world.calls).toEqual([]);
    expect((await lounge(control)).owner).toBe("external");
  });
});

describe("a bedroom heater sleep timer", () => {
  it("turns the element off when it expires after the room was taken by hand", async () => {
    resetWorld({ bedroomHeater: { mode: "auto", temperature: 20 } });
    const control = await loadController();

    setWorld({ heater: { state: "off", roomTemperature: 18 } });
    await settle(control);
    expect(heaterCalls("turn_on").length).toBeGreaterThanOrEqual(1);
    setWorld({ heater: { state: "on", roomTemperature: 18 } });
    await settle(control);
    expect((await bedroom(control)).owner).toBe("nova");

    // Out at the wall switch, past the settle window.
    vi.setSystemTime(new Date("2026-09-19T08:20:00.000Z"));
    setWorld({ heater: { state: "off", roomTemperature: 18 } });
    await settle(control);
    expect((await bedroom(control)).owner).toBe("external");

    setWorld({ heater: { state: "on", roomTemperature: 18 } });
    world.preferences = merge(world.preferences, { bedroomHeater: { offTimerEndsAt: "2026-09-19T08:30:00.000Z" } });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00.000Z"));
    await settle(control);

    expect(heaterCalls("turn_off").length).toBeGreaterThanOrEqual(1);
    expect((await bedroom(control)).owner).toBe("external");

    // The element obeys the stop it was sent, and the card reads Off.
    setWorld({ heater: { state: "off", roomTemperature: 18 } });
    await settle(control);
    expect((await bedroom(control)).mode).toBe("off");
  });
});
