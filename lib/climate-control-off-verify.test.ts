import { describe, expect, it } from "vitest";
import { OFF_RESEND_EVERY_MS, OFF_RESEND_MAX, OFF_RESEND_WINDOW_MS } from "./climate-control/constants";
import { noteOffRequest, offNeedsResending } from "./climate-control/off-verify-model";
import { defaultRoom, withClimateLock } from "./climate-control/store";

/*
 * Off must reach the unit (alex, 2026-10-26: "sometimes its in manual mode and
 * I set it to off and nothing happens, the aircon stays on").
 */
describe("an Off the unit has not obeyed", () => {
  const pressed = (at: number) => {
    const room = { ...defaultRoom(), mode: "off" as const };
    const realNow = Date.now;
    Date.now = () => at;
    noteOffRequest(room, "off");
    Date.now = realNow;
    return room;
  };

  it("is sent again once the unit has had a few seconds to answer", () => {
    const room = pressed(1_000_000);
    expect(offNeedsResending({ room, unitOn: true, now: 1_000_000 + 1_000 })).toBe(false);
    expect(offNeedsResending({ room, unitOn: true, now: 1_000_000 + OFF_RESEND_EVERY_MS })).toBe(true);
  });

  it("is not sent when the unit already reports off", () => {
    const room = pressed(1_000_000);
    expect(offNeedsResending({ room, unitOn: false, now: 1_000_000 + OFF_RESEND_EVERY_MS })).toBe(false);
  });

  it("gives up after its window and its resend budget", () => {
    const room = pressed(1_000_000);
    expect(offNeedsResending({ room, unitOn: true, now: 1_000_000 + OFF_RESEND_WINDOW_MS + 1 })).toBe(false);
    room.offResends = OFF_RESEND_MAX;
    expect(offNeedsResending({ room, unitOn: true, now: 1_000_000 + OFF_RESEND_EVERY_MS })).toBe(false);
  });

  it("leaves a unit alone when someone else has it, or when Off was not pressed", () => {
    const room = pressed(1_000_000);
    expect(offNeedsResending({ room: { ...room, owner: "external" }, unitOn: true, now: 1_000_000 + OFF_RESEND_EVERY_MS })).toBe(false);
    noteOffRequest(room, "manual");
    expect(offNeedsResending({ room: { ...room, mode: "manual" }, unitOn: true, now: 1_000_000 + OFF_RESEND_EVERY_MS })).toBe(false);
  });
});

describe("withClimateLock", () => {
  it("runs a press after the tick in flight, never between its reads and writes", async () => {
    const order: string[] = [];
    const tick = withClimateLock(async () => {
      order.push("tick:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("tick:end");
    });
    const press = withClimateLock(async () => {
      order.push("press");
    });
    await Promise.all([tick, press]);
    expect(order).toEqual(["tick:start", "tick:end", "press"]);
  });

  it("keeps running after a task throws", async () => {
    await expect(withClimateLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withClimateLock(async () => "ok")).resolves.toBe("ok");
  });
});
