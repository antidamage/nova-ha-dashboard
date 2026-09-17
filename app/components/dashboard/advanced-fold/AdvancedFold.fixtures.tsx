// Shared render and gesture helpers for the AdvancedFold suites. It is
// deliberately not a `*.test.*` file: vitest collects those by glob, and a
// helper must not be collected as a suite of its own.
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { AdvancedFold } from "../AdvancedFold";

export function matchWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("aspect-ratio") ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

export function renderFold(advanced: ReactNode = <p>Advanced detail</p>) {
  const view = render(
    <AdvancedFold advanced={advanced}>
      <p>Default view</p>
      <div role="slider" aria-label="Knob"><span>face</span></div>
      <div role="switch" aria-checked="false" aria-label="Ring" />
    </AdvancedFold>,
  );
  const fold = view.container.querySelector(".advanced-fold") as HTMLElement;
  const track = view.container.querySelector(".advanced-fold-track") as HTMLElement | null;
  return { ...view, fold, track };
}

/** A mouse drag toward Advanced by `pixels` along the fold's axis. */
export function drag(target: HTMLElement, pixels: number, axis: "x" | "y" = "y", release = true) {
  fireEvent.mouseDown(target, { button: 0, clientX: 300, clientY: 300 });
  const step = pixels / 4;
  for (let i = 1; i <= 4; i += 1) {
    fireEvent.mouseMove(window, axis === "y"
      ? { clientX: 300, clientY: 300 - step * i }
      : { clientX: 300 - step * i, clientY: 300 });
  }
  if (release) fireEvent.mouseUp(window);
}
