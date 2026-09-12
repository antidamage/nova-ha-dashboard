import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
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

// jsdom has no matchMedia, and `useWideDashboard` reads it through
// useSyncExternalStore the moment anything using it mounts. Default to
// portrait, matching the hook's own server snapshot; a test that wants
// landscape stubs it over the top (see HorizontalAccordion.test.tsx).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Route the fire-and-forget spools at a throwaway directory.
//
// `emitDashboardEvent` and the kiosk witness store both default to
// `process.cwd()/data/...`, which under vitest is the repo. Any test that
// exercises a control route therefore drops real spool files into the working
// tree — harmless (the deploy excludes `data/`) but it dirties `git status` and
// the host-side drain would forward them as genuine events if they ever did
// ship. Pointing both at a temp dir keeps the tests honest without stubbing
// out the emit path, which is worth exercising.
const scratch = mkdtempSync(path.join(tmpdir(), "nova-test-"));
process.env.NOVA_EVENTS_DIR = path.join(scratch, "events");
process.env.NOVA_KIOSK_WITNESS_DIR = path.join(scratch, "kiosk-witness");
