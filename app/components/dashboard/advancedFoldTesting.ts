import { fireEvent } from "@testing-library/react";
import { ADVANCED_FOLD_BREAK_PX } from "./advancedFoldBand";

/**
 * jsdom has no layout, so a fold's scroll geometry is faked: `closed` px of
 * content while closed, `closed + advanced` once the advanced region has
 * mounted, in a `client` px sub-panel. Offsets clamp as a browser's would.
 * Test-only.
 */
export function fakeFoldGeometry(
  fold: HTMLElement,
  { client = 300, closed = 300, advanced = 600 }: { client?: number; closed?: number; advanced?: number } = {},
) {
  let offset = 0;
  const scroll = () => closed + (fold.querySelector(".advanced-fold-advanced") ? advanced : 0);
  const max = () => Math.max(0, scroll() - client);
  const define = (name: string, get: () => number, set?: (value: number) => void) =>
    Object.defineProperty(fold, name, { configurable: true, get, set });
  const setOffset = (value: number) => {
    offset = Math.min(Math.max(value, 0), max());
  };
  define("clientHeight", () => client);
  define("clientWidth", () => client);
  define("scrollHeight", scroll);
  define("scrollWidth", scroll);
  define("scrollTop", () => Math.min(offset, max()), setOffset);
  define("scrollLeft", () => Math.min(offset, max()), setOffset);
  return {
    setAdvanced(value: number) {
      advanced = value;
    },
  };
}

/** Pull a fold open with a mouse drag, diagonally so either axis breaks it. */
export function openAdvancedFold(container: HTMLElement, fold?: HTMLElement) {
  const node = fold ?? (container.querySelector(".advanced-fold:not([data-foldless])") as HTMLElement);
  fakeFoldGeometry(node);
  const travel = ADVANCED_FOLD_BREAK_PX + 20;
  fireEvent.mouseDown(node, { button: 0, clientX: 200, clientY: 200 });
  fireEvent.mouseMove(window, { clientX: 200 - travel, clientY: 200 - travel });
  fireEvent.mouseUp(window);
}
