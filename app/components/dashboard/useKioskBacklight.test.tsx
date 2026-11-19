import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SunStatus } from "../../../lib/types";
import { DARK_EXPIRES_MS, KIOSK_BACKLIGHT_EVENT, SWALLOW_AFTER_DARK_MS, useKioskBacklight, type KioskBacklightState } from "./useKioskBacklight";

const win = window as { novaKioskBacklight?: unknown; __novaKioskBacklight?: unknown };
const night = { state: "below_horizon" } as SunStatus;
const day = { state: "above_horizon" } as SunStatus;

function Probe({ sun, onClick }: { sun: SunStatus | null; onClick?: () => void }) {
  useKioskBacklight(sun);
  return (
    <button type="button" onClick={onClick}>
      heater
    </button>
  );
}

function report(state: KioskBacklightState) {
  win.__novaKioskBacklight = state;
  act(() => {
    window.dispatchEvent(new CustomEvent(KIOSK_BACKLIGHT_EVENT, { detail: state }));
  });
}

function sent(binding: ReturnType<typeof vi.fn>) {
  return binding.mock.calls.map(([payload]) => JSON.parse(payload as string));
}

describe("useKioskBacklight", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete win.novaKioskBacklight;
    delete win.__novaKioskBacklight;
  });

  it("does nothing, and swallows nothing, without the kiosk service", () => {
    const onClick = vi.fn();
    const { getByText } = render(<Probe sun={night} onClick={onClick} />);
    report({ phase: "dark", level: 0, dark: true });
    fireEvent.click(getByText("heater"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("sends the adaptive target: 60 at night, 100 by day", () => {
    const binding = vi.fn();
    win.novaKioskBacklight = binding;
    const { rerender } = render(<Probe sun={night} />);
    expect(sent(binding)).toContainEqual({ target: 60 });
    rerender(<Probe sun={day} />);
    expect(sent(binding).at(-1)).toEqual({ target: 100 });
  });

  it("finds a binding the service installs after the page loaded", () => {
    const binding = vi.fn();
    render(<Probe sun={night} />);
    win.novaKioskBacklight = binding;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(sent(binding)).toContainEqual({ target: 60 });
  });

  it("swallows a tap on a dark panel, and for 500 ms after it lights", () => {
    win.novaKioskBacklight = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Probe sun={night} onClick={onClick} />);
    report({ phase: "dim", level: 10, target: 60, dark: true });
    fireEvent.click(getByText("heater"));
    expect(onClick).not.toHaveBeenCalled();

    report({ phase: "rise", level: 30, target: 60, dark: false });
    fireEvent.click(getByText("heater"));
    expect(onClick).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SWALLOW_AFTER_DARK_MS + 1);
    });
    fireEvent.click(getByText("heater"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stops swallowing when the service goes quiet while dark", () => {
    win.novaKioskBacklight = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Probe sun={night} onClick={onClick} />);
    report({ phase: "dark", level: 0, target: 60, dark: true });
    act(() => {
      vi.advanceTimersByTime(DARK_EXPIRES_MS - 1000);
    });
    fireEvent.click(getByText("heater"));
    expect(onClick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(getByText("heater"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a tap through on a visible dim", () => {
    win.novaKioskBacklight = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Probe sun={night} onClick={onClick} />);
    report({ phase: "dim", level: 40, target: 60, dark: false });
    fireEvent.click(getByText("heater"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("resends its target on a wake and when the service disagrees", () => {
    const binding = vi.fn();
    win.novaKioskBacklight = binding;
    render(<Probe sun={night} />);
    binding.mockClear();
    report({ phase: "rise", level: 0, target: 60, dark: true, woke: true });
    expect(sent(binding)).toEqual([{ target: 60 }]);
    binding.mockClear();
    report({ phase: "hold", level: 100, target: 100, dark: false });
    expect(sent(binding)).toEqual([{ target: 60 }]);
  });

  it("covers the page in black while blank, and lifts the cover on a tap or a rise", () => {
    win.novaKioskBacklight = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Probe sun={night} onClick={onClick} />);
    const cover = () => document.querySelector<HTMLElement>("[data-kiosk-backlight-cover]");
    expect(cover()?.style.display).toBe("none");
    report({ phase: "off", level: 0, target: 60, dark: true, blank: true });
    expect(cover()?.style.display).toBe("block");
    fireEvent.pointerDown(getByText("heater"));
    fireEvent.click(getByText("heater"));
    expect(cover()?.style.display).toBe("none");
    expect(onClick).not.toHaveBeenCalled();
    report({ phase: "off", level: 0, target: 60, dark: true, blank: true });
    report({ phase: "rise", level: 0, target: 60, dark: true, blank: false, woke: true });
    expect(cover()?.style.display).toBe("none");
  });

  it("removes its cover on unmount", () => {
    win.novaKioskBacklight = vi.fn();
    const { unmount } = render(<Probe sun={night} />);
    unmount();
    expect(document.querySelector("[data-kiosk-backlight-cover]")).toBeNull();
  });

  it("reports pointer activity to the service, throttled", () => {
    const binding = vi.fn();
    win.novaKioskBacklight = binding;
    const { getByText } = render(<Probe sun={night} />);
    binding.mockClear();
    fireEvent.pointerDown(getByText("heater"));
    fireEvent.pointerDown(getByText("heater"));
    expect(sent(binding)).toEqual([{ activity: true }]);
  });
});
