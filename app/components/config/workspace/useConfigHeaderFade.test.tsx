import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_HEADER_FADE_DISTANCE } from "./constants";
import { useConfigHeaderFade } from "./useConfigHeaderFade";

function Harness() {
  useConfigHeaderFade();
  return null;
}

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value });
}

const fade = () => document.documentElement.style.getPropertyValue("--nova-header-fade");

describe("useConfigHeaderFade", () => {
  afterEach(() => {
    setScrollY(0);
    document.documentElement.style.removeProperty("--nova-header-fade");
    document.documentElement.classList.remove("nova-header-controls-disabled");
  });

  it("drives the strip from scroll position and stops at full strength", () => {
    const { unmount } = render(<Harness />);
    expect(fade()).toBe("0.0000");

    act(() => {
      setScrollY(CONFIG_HEADER_FADE_DISTANCE / 2);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(Number(fade())).toBeCloseTo(0.5, 3);

    act(() => {
      setScrollY(CONFIG_HEADER_FADE_DISTANCE * 4);
      window.dispatchEvent(new Event("scroll"));
    });
    expect(fade()).toBe("1.0000");

    unmount();
    expect(fade()).toBe("");
  });

  it("leaves the header controls live, unlike the dashboard's orb handler", () => {
    render(<Harness />);

    act(() => {
      setScrollY(CONFIG_HEADER_FADE_DISTANCE);
      window.dispatchEvent(new Event("scroll"));
    });

    expect(document.documentElement.classList.contains("nova-header-controls-disabled")).toBe(false);
  });
});
