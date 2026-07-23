import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATUS_ORB_INFO_CHANGE_EVENT,
  STATUS_ORB_INFO_STORAGE_KEY,
  readStatusOrbInfoSetting,
  writeStatusOrbInfoSetting,
} from "./statusOrbInfoSetting";

describe("status orb info setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-nova-hide-orb-info");
  });

  it("defaults to visible and round-trips the hidden preference", () => {
    expect(readStatusOrbInfoSetting()).toBe(true);
    writeStatusOrbInfoSetting(false);
    expect(window.localStorage.getItem(STATUS_ORB_INFO_STORAGE_KEY)).toBe("false");
    expect(readStatusOrbInfoSetting()).toBe(false);
    expect(document.documentElement).toHaveAttribute("data-nova-hide-orb-info");
    writeStatusOrbInfoSetting(true);
    expect(readStatusOrbInfoSetting()).toBe(true);
    expect(document.documentElement).not.toHaveAttribute("data-nova-hide-orb-info");
  });

  it("notifies same-page consumers", () => {
    const listener = vi.fn();
    window.addEventListener(STATUS_ORB_INFO_CHANGE_EVENT, listener);
    writeStatusOrbInfoSetting(false);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(STATUS_ORB_INFO_CHANGE_EVENT, listener);
  });
});
