import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; the slider/spectrum controls observe their track
// width with it. A no-op stub lets those components mount under test.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}
