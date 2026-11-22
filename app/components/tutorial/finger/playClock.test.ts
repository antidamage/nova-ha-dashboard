import { describe, expect, it } from "vitest";
import { PlayClock } from "./playClock";

describe("PlayClock", () => {
  it("stands still while paused and carries on from the same point", () => {
    let real = 1000;
    const clock = new PlayClock(() => real);
    expect(clock.now()).toBe(1000);
    real = 1500;
    clock.pause();
    real = 9000;
    expect(clock.paused).toBe(true);
    expect(clock.now()).toBe(1500);
    clock.resume();
    expect(clock.now()).toBe(1500);
    real = 9100;
    expect(clock.now()).toBe(1600);
  });

  it("ignores a second pause and a resume while running", () => {
    let real = 0;
    const clock = new PlayClock(() => real);
    clock.resume();
    clock.pause();
    real = 50;
    clock.pause();
    real = 80;
    clock.resume();
    expect(clock.now()).toBe(0);
  });
});
