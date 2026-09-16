import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity } from "../../../../lib/types";
import { AirconKnob, HeaterKnob } from "../ClimateKnobs";
import { CLIMATE_MODE_COMMIT_DEBOUNCE_MS } from "../climateCommands";

const DIAL_BOX = 248.8;

beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
    if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
    return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
  };
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ aircon: {} }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Freshly reported: airconAutoMeasuredTemperature refuses a stale reading, so
// a fixture without these timestamps has no room temperature at all.
const FRESH = new Date().toISOString();

const AIRCON: DashboardEntity = {
  entity_id: "climate.lounge",
  domain: "climate",
  name: "Lounge",
  state: "cool",
  last_changed: FRESH,
  last_updated: FRESH,
  last_reported: FRESH,
  attributes: { hvac_modes: ["off", "heat", "cool", "fan_only"], min_temp: 16, max_temp: 30, temperature: 22, current_temperature: 23, fan_mode: "medium" },
} as unknown as DashboardEntity;

const FRESH_AIR: DashboardEntity = {
  entity_id: "switch.lounge_fresh_air",
  domain: "switch",
  name: "Fresh air",
  state: "off",
  attributes: {},
} as unknown as DashboardEntity;

const HEATER_SWITCH: DashboardEntity = {
  entity_id: "switch.bedroom_heater",
  domain: "switch",
  name: "Heater",
  state: "on",
  attributes: {},
} as unknown as DashboardEntity;

/** A tap on the knob: press and release without moving. */
function tapDial(held = 120) {
  const dial = screen.getAllByRole("slider")[0];
  let time = 1000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => time);
  fireEvent.pointerDown(dial, { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
  time += held;
  fireEvent.pointerUp(dial, { clientX: 40, clientY: 40, pointerId: 1 });
  spy.mockRestore();
}

describe("the air conditioner's knob", () => {
  it("has three mode lights and its four rings, innermost first", () => {
    render(<AirconKnob entity={AIRCON} freshAirSwitch={FRESH_AIR} title="Lounge" onEntityActions={vi.fn()} />);
    // It starts locked, so open it before the rings are there to find.
    tapDial();
    const rings = Array.from(document.querySelectorAll("[data-ring-id]")).map((ring) => ring.getAttribute("data-ring-id"));
    expect(rings).toEqual(["mode", "fan", "fresh", "timer"]);
    expect(document.querySelectorAll(".rotary-encoder-led")).toHaveLength(3);
  });

  it("labels the mode ring and adds Dry only where the unit has it or is in it", () => {
    const modeRing = () => document.querySelector("[data-ring-id='mode']");
    const { unmount } = render(<AirconKnob entity={AIRCON} title="Lounge" onEntityActions={vi.fn()} />);
    tapDial();
    expect(modeRing()?.getAttribute("aria-valuemax")).toBe("2");
    expect(document.querySelector(".rotary-encoder-ring-value")?.textContent).toBe("COOL");
    unmount();

    const drying = { ...AIRCON, state: "dry" } as DashboardEntity;
    render(<AirconKnob entity={drying} title="Lounge" onEntityActions={vi.fn()} />);
    tapDial();
    expect(modeRing()?.getAttribute("aria-valuemax")).toBe("3");
    expect(modeRing()?.getAttribute("aria-valuetext")).toBe("DRY");
  });

  it("leaves the fresh-air ring out of a home without that switch", () => {
    render(<AirconKnob entity={AIRCON} title="Lounge" onEntityActions={vi.fn()} />);
    tapDial();
    const rings = Array.from(document.querySelectorAll("[data-ring-id]")).map((ring) => ring.getAttribute("data-ring-id"));
    expect(rings).toEqual(["mode", "fan", "timer"]);
  });

  it("sends only the mode the taps settle on, once they stop", () => {
    vi.useFakeTimers();
    const onEntityActions = vi.fn(async () => undefined);
    render(<AirconKnob entity={AIRCON} title="Lounge" onEntityActions={onEntityActions} />);
    tapDial();

    // Unlocked. Two taps move the lights on two modes; nothing is sent yet.
    tapDial();
    tapDial();
    expect(onEntityActions).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CLIMATE_MODE_COMMIT_DEBOUNCE_MS + 10));
    // One command, for the mode it ended on — never the one it passed through.
    expect(onEntityActions).toHaveBeenCalledTimes(1);
    const toast = String((onEntityActions.mock.calls as unknown as unknown[][])[0][1]);
    expect(toast).toContain("Air Conditioner");
  });

  it("says nothing when the taps come back to where they started", () => {
    vi.useFakeTimers();
    const onEntityActions = vi.fn(async () => undefined);
    render(<AirconKnob entity={AIRCON} title="Lounge" onEntityActions={onEntityActions} />);
    tapDial();
    // Three lights: three taps is a full circle, back to the starting mode.
    tapDial();
    tapDial();
    tapDial();
    act(() => vi.advanceTimersByTime(CLIMATE_MODE_COMMIT_DEBOUNCE_MS + 10));
    expect(onEntityActions).not.toHaveBeenCalled();
  });

  it("shows the room's temperature under the lights and the target above them", () => {
    const { container } = render(<AirconKnob entity={AIRCON} title="Lounge" onEntityActions={vi.fn()} />);
    expect(container.querySelector(".temperature-encoder-target")?.textContent).toBe("22°");
    expect(container.querySelector(".temperature-encoder-room")?.textContent).toBe("23°");
  });

  it("sweeps the household range and pulls an outside target in, once", () => {
    vi.useFakeTimers();
    const onEntityActions = vi.fn(async () => undefined);
    render(<AirconKnob entity={AIRCON} preferredRange={{ min: 18, max: 21 }} title="Lounge" onEntityActions={onEntityActions} />);
    const dial = screen.getAllByRole("slider")[0];
    expect(dial.getAttribute("aria-valuemin")).toBe("18");
    expect(dial.getAttribute("aria-valuemax")).toBe("21");
    act(() => vi.advanceTimersByTime(10000));
    const sent = JSON.stringify(onEntityActions.mock.calls);
    expect(sent).toContain("set_temperature");
    expect(sent).toContain('"temperature":21');
    expect(onEntityActions).toHaveBeenCalledTimes(1);
  });
});

describe("the heater's knob", () => {
  it("has two mode lights and one ring", () => {
    render(<HeaterKnob switchEntity={HEATER_SWITCH} temperature={19.5} title="Bedroom" />);
    tapDial();
    expect(document.querySelectorAll(".rotary-encoder-led")).toHaveLength(2);
    const rings = Array.from(document.querySelectorAll("[data-ring-id]")).map((ring) => ring.getAttribute("data-ring-id"));
    expect(rings).toEqual(["timer"]);
  });

  it("reads the room to a decimal place", () => {
    const { container } = render(<HeaterKnob switchEntity={HEATER_SWITCH} temperature={19.5} title="Bedroom" />);
    expect(container.querySelector(".temperature-encoder-room")?.textContent).toBe("19.5°");
  });

  it("shows no reading as -- rather than a degree sign on nothing", () => {
    const { container } = render(<HeaterKnob switchEntity={HEATER_SWITCH} temperature={null} title="Bedroom" />);
    expect(container.querySelector(".temperature-encoder-room")?.textContent).toBe("--");
  });
});
