import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arePageUpdatesPaused,
  setPageUpdatesPaused,
  subscribePageUpdatePause,
} from "./pageUpdatePause";

describe("page update pause", () => {
  beforeEach(() => setPageUpdatesPaused(false));

  it("toggles the root performance hint and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePageUpdatePause(listener);
    setPageUpdatesPaused(true);
    expect(arePageUpdatesPaused()).toBe(true);
    expect(document.documentElement).toHaveAttribute("data-nova-scroll-active");
    expect(listener).toHaveBeenLastCalledWith(true);
    setPageUpdatesPaused(false);
    expect(document.documentElement).not.toHaveAttribute("data-nova-scroll-active");
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });
});
