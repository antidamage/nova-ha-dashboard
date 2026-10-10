import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_ROTATION_STORAGE_KEY, readDisplayRotationSetting, writeDisplayRotationSetting } from "./dashboard/displayRotationSetting";
import { RotateDisplayButton } from "./RotateDisplayButton";

const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

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

describe("RotateDisplayButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(DESKTOP);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { novaKioskRotate?: unknown }).novaKioskRotate;
  });

  it("renders nothing until the setting is on", () => {
    render(<RotateDisplayButton />);
    expect(screen.queryByRole("button", { name: "Rotate display clockwise" })).toBeNull();
  });

  it("renders when allowed and calls the kiosk service once per tap", () => {
    const rotate = vi.fn();
    (window as { novaKioskRotate?: unknown }).novaKioskRotate = rotate;
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, "true");

    render(<RotateDisplayButton />);
    const button = screen.getByRole("button", { name: "Rotate display clockwise" });
    expect(button.className).toContain("dashboard-config-link");

    fireEvent.click(button);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(rotate).toHaveBeenCalledWith("clockwise");
  });

  it("stays hidden on a device that rotates itself, whatever is stored", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 8)");
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, "true");

    render(<RotateDisplayButton />);
    expect(screen.queryByRole("button", { name: "Rotate display clockwise" })).toBeNull();
  });

  it("warns instead of throwing when the machine has no rotation service", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, "true");

    render(<RotateDisplayButton />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate display clockwise" }));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
