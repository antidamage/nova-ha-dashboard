const { playControlSound } = vi.hoisted(() => ({ playControlSound: vi.fn() }));

vi.mock("./dashboard/controlSound", () => ({ playControlSound }));

import { buttonHaptic, roundHapticInterval, selectionHaptic, SliderHapticController, triggerHaptic } from "./haptics";

describe("haptics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    playControlSound.mockReset();
    delete (window as Window & { webkit?: unknown }).webkit;
    document.querySelectorAll("[data-nova-ios-haptic]").forEach((element) => element.remove());
  });

  it("prefers the native iOS bridge", () => {
    const postMessage = vi.fn();
    (window as Window & { webkit?: unknown }).webkit = {
      messageHandlers: { novaHaptics: { postMessage } },
    };
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });

    expect(triggerHaptic("button")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ style: "button" });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("uses tiny browser vibration pulses", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });

    triggerHaptic("button");
    triggerHaptic("selection");

    expect(vibrate).toHaveBeenNthCalledWith(1, 12);
    expect(vibrate).toHaveBeenNthCalledWith(2, 9);
  });

  it("toggles a hidden native switch when the Vibration API is unavailable", () => {
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });

    expect(triggerHaptic("selection")).toBe(true);

    const input = document.querySelector<HTMLInputElement>("input[data-nova-ios-haptic]");
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute("switch");
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toBeChecked();
  });

  it("falls through to the native switch when vibration is present but declines the pulse", () => {
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vi.fn(() => false) });

    expect(triggerHaptic("button")).toBe(true);
    expect(document.querySelector("input[data-nova-ios-haptic]")).toBeChecked();
  });

  it("plays the established control sound with button and slider feedback", () => {
    buttonHaptic();
    selectionHaptic();

    expect(playControlSound).toHaveBeenCalledTimes(2);
  });

  it("scales slow-drag landmarks to values ending in zero or five", () => {
    expect(roundHapticInterval(0.01)).toBe(0.05);
    expect(roundHapticInterval(0.1)).toBe(0.5);
    expect(roundHapticInterval(1)).toBe(5);
    expect(roundHapticInterval(2)).toBe(10);
    expect(roundHapticInterval(10)).toBe(10);
  });

  it("ticks on round value crossings when moving slowly", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const controller = new SliderHapticController();
    controller.start({ now: 0, step: 1, value: 2 });

    expect(controller.move(0.01, { now: 250, value: 3 })).toBe(false);
    expect(controller.move(0.01, { now: 500, value: 4 })).toBe(false);
    expect(controller.move(0.01, { now: 750, value: 5 })).toBe(true);
    expect(controller.move(0.01, { now: 1000, value: 6 })).toBe(false);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(playControlSound).toHaveBeenCalledTimes(2);
  });

  it("uses 0.05 landmarks for hundredth-step fine tuning", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const controller = new SliderHapticController();
    controller.start({ now: 0, step: 0.01, value: 0.02 });

    expect(controller.move(0.01, { now: 250, value: 0.03 })).toBe(false);
    expect(controller.move(0.01, { now: 500, value: 0.04 })).toBe(false);
    expect(controller.move(0.01, { now: 750, value: 0.05 })).toBe(true);
  });

  it("caps fast movement at 12.5 ticks per second", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const controller = new SliderHapticController();
    controller.start({ now: 0 });

    for (let now = 10; now <= 400; now += 10) controller.move(0.05, { now });

    // One initial contact plus no more than five movement ticks in 400ms.
    expect(vibrate.mock.calls.length).toBeGreaterThan(3);
    expect(vibrate.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
