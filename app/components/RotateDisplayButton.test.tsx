import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_ROTATION_STORAGE_KEY, readDisplayRotationSetting, writeDisplayRotationSetting } from "./dashboard/displayRotationSetting";
import { asKioskRotation, KIOSK_ROTATION_EVENT_NAME, rotationSteps } from "./dashboard/kioskRotation";
import { RotateDisplayButton } from "./RotateDisplayButton";
import { MODAL_DISMISS_MS } from "./RotateDisplayModal";

const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const win = window as { novaKioskRotate?: unknown; __novaKioskRotation?: unknown };

function setKioskRotation(name: string) {
  win.__novaKioskRotation = name;
  window.dispatchEvent(new CustomEvent(KIOSK_ROTATION_EVENT_NAME, { detail: name }));
}

describe("display rotation setting", () => {
  beforeEach(() => window.localStorage.clear());

  it("is off when the key is absent or anything but true", () => {
    expect(readDisplayRotationSetting()).toBe(false);
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, "yes");
    expect(readDisplayRotationSetting()).toBe(false);
  });

  it("round-trips", () => {
    writeDisplayRotationSetting(true);
    expect(window.localStorage.getItem(DISPLAY_ROTATION_STORAGE_KEY)).toBe("true");
    expect(readDisplayRotationSetting()).toBe(true);
    writeDisplayRotationSetting(false);
    expect(readDisplayRotationSetting()).toBe(false);
  });
});

describe("kiosk rotation steps", () => {
  it("counts clockwise quarter-turns round the cycle", () => {
    expect(rotationSteps("normal", "left")).toBe(1);
    expect(rotationSteps("left", "inverted")).toBe(1);
    expect(rotationSteps("right", "normal")).toBe(1);
    expect(rotationSteps("normal", "inverted")).toBe(2);
    expect(rotationSteps("left", "normal")).toBe(3);
    expect(rotationSteps("right", "right")).toBe(0);
  });

  it("ignores names that are not rotations", () => {
    expect(asKioskRotation("sideways")).toBeNull();
    expect(asKioskRotation(undefined)).toBeNull();
  });
});

describe("RotateDisplayButton and its modal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    delete win.__novaKioskRotation;
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(DESKTOP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete win.novaKioskRotate;
    delete win.__novaKioskRotation;
  });

  function allow() {
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, "true");
  }

  const corner = () => screen.getByRole("button", { name: "Rotate display" });
  const icon = () => screen.getByRole("button", { name: "Rotate display clockwise" });
  const box = () => document.querySelector<HTMLElement>(".rotate-modal-box")!;

  it("renders nothing until the setting is on", () => {
    render(<RotateDisplayButton />);
    expect(screen.queryByRole("button", { name: "Rotate display" })).toBeNull();
  });

  it("stays hidden on a device that rotates itself, whatever is stored", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 8)");
    allow();
    render(<RotateDisplayButton />);
    expect(screen.queryByRole("button", { name: "Rotate display" })).toBeNull();
  });

  it("the corner button opens the modal and rotates nothing itself", () => {
    const rotate = vi.fn();
    win.novaKioskRotate = rotate;
    allow();
    render(<RotateDisplayButton />);
    expect(corner().className).toContain("dashboard-config-link");

    fireEvent.click(corner());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(rotate).not.toHaveBeenCalled();
  });

  it("each tap on the icon rotates once, and the modal stays open", () => {
    const rotate = vi.fn();
    win.novaKioskRotate = rotate;
    allow();
    render(<RotateDisplayButton />);
    fireEvent.click(corner());

    fireEvent.click(icon());
    fireEvent.click(icon());
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(rotate).toHaveBeenCalledWith("clockwise");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("a tap outside the icon dismisses, including on the box around it", () => {
    allow();
    render(<RotateDisplayButton />);
    fireEvent.click(corner());
    fireEvent.click(box());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(corner());
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses after three seconds without a tap, and each tap restarts the wait", () => {
    win.novaKioskRotate = vi.fn();
    allow();
    render(<RotateDisplayButton />);
    fireEvent.click(corner());

    act(() => {
      vi.advanceTimersByTime(MODAL_DISMISS_MS - 100);
    });
    fireEvent.click(icon());
    act(() => {
      vi.advanceTimersByTime(MODAL_DISMISS_MS - 100);
    });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the icon button takes the dials' light or dark skin", () => {
    allow();
    document.documentElement.dataset.knobSkin = "light";
    try {
      render(<RotateDisplayButton />);
      fireEvent.click(corner());
      expect(icon().className).toContain("rotate-modal-icon");
      expect(icon().getAttribute("data-mode")).toBe("light");
    } finally {
      delete document.documentElement.dataset.knobSkin;
    }
  });

  it("the icon button is the dark skin when the theme pins dark", () => {
    allow();
    document.documentElement.dataset.knobSkin = "dark";
    try {
      render(<RotateDisplayButton />);
      fireEvent.click(corner());
      expect(icon().getAttribute("data-mode")).toBe("dark");
    } finally {
      delete document.documentElement.dataset.knobSkin;
    }
  });

  it("counter-rotates as the display turns, so the box keeps its orientation", () => {
    win.novaKioskRotate = vi.fn();
    win.__novaKioskRotation = "normal";
    allow();
    render(<RotateDisplayButton />);
    fireEvent.click(corner());
    expect(box().style.transform).toBe("rotate(0deg)");

    act(() => setKioskRotation("left"));
    expect(box().style.transform).toBe("rotate(-90deg)");

    act(() => setKioskRotation("inverted"));
    expect(box().style.transform).toBe("rotate(-180deg)");

    act(() => setKioskRotation("right"));
    act(() => setKioskRotation("normal"));
    expect(box().style.transform).toBe("rotate(-360deg)");
  });

  it("warns instead of throwing when the machine has no rotation service", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    allow();
    render(<RotateDisplayButton />);
    fireEvent.click(corner());
    fireEvent.click(icon());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
