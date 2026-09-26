import { vi } from "vitest";
import { AUTO_RELOAD_REASON_KEY } from "./autoReloadTelemetry";
import { resetBuildReloadStateForTests } from "./buildReloadPolicy";
import { useBuildReload } from "./useBuildReload";

// The shared harness for the build-reload tests: a stand-in EventSource the test
// drives, a visibility it states, a scripted /api/version, and a `reload` it can
// count. Named `*.fixtures` so lib/architecture.test.ts keeps it test-only.

export function Harness() {
  useBuildReload();
  return null;
}

/** Stands in for the shared EventSource: jsdom has no SSE and the test drives it. */
export class FakeEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  static emitAll(type: string, data: string) {
    for (const instance of FakeEventSource.instances) {
      for (const handler of instance.listeners.get(type) ?? []) {
        handler({ data } as MessageEvent);
      }
    }
  }
}

let reloadCount = 0;

export function getReloads() {
  return reloadCount;
}

/** jsdom reports the document hidden/prerender by default, so tests state it. */
export function setVisibility(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

export function dispatchVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

export function stubVersion(initialBuildId: string) {
  const box = { buildId: initialBuildId };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/version") {
      return { ok: true, json: async () => ({ buildId: box.buildId }) } as unknown as Response;
    }
    if (url === "/api/events") {
      return { ok: true } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return box;
}

export function lastAutoReload() {
  return JSON.parse(window.sessionStorage.getItem(AUTO_RELOAD_REASON_KEY) ?? "null");
}

/**
 * A fresh document: no policy state, no storage, no SSE, and a `reload` that is
 * counted instead of navigating (jsdom cannot navigate; it logs "Not
 * implemented" otherwise).
 */
export function prepareBuildReloadTest() {
  reloadCount = 0;
  resetBuildReloadStateForTests();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  try {
    window.sessionStorage.clear();
  } catch {
    // private mode — nothing to clear
  }
  const originalLocation = window.location;
  // @ts-expect-error -- deliberately replacing the read-only global for the test
  delete window.location;
  // @ts-expect-error -- partial Location, only reload is exercised
  window.location = {
    ...originalLocation,
    reload: () => {
      reloadCount += 1;
    },
  };
}
