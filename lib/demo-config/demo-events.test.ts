import { afterEach, describe, expect, it, vi } from "vitest";
import { readDefaultDashboardConfig } from "../dashboard-config";
import { demoConfigBootstrapScript } from "../demo-config";

type Listener = (event: { data: string }) => void;
type DemoSource = { addEventListener: (type: string, listener: Listener) => void; close: () => void };
type FakeProvider = {
  handleRequest: () => Promise<Response>;
  subscribe?: (listener: (name: string, data: unknown) => void) => () => void;
  eventSnapshot?: () => Promise<Array<[string, unknown]>>;
};
type TestGlobal = typeof globalThis & { __demoImport?: () => Promise<{ createNovaDummyProvider: () => FakeProvider }> };

const emptyResponse = async () => new Response("{}", { headers: { "Content-Type": "application/json" } });

/** The shim as the page runs it, with the provider's dynamic import pointed at a fake. */
async function boot(provider: FakeProvider) {
  (globalThis as TestGlobal).__demoImport = async () => ({ createNovaDummyProvider: () => provider });
  const script = demoConfigBootstrapScript(await readDefaultDashboardConfig(), "https://provider.example/demo/")
    .replace('import(new URL("provider.mjs", bootstrap.providerBase).href)', "globalThis.__demoImport()");
  const native = window.fetch;
  const nativeSource = window.EventSource;
  window.fetch = vi.fn() as unknown as typeof window.fetch;
  new Function(script)();
  // A request is what loads the provider, on the page as here.
  await window.fetch("/api/state");
  return {
    source: () => new window.EventSource("/api/events") as unknown as DemoSource,
    restore: () => { window.fetch = native; window.EventSource = nativeSource; },
  };
}

afterEach(() => {
  delete (globalThis as TestGlobal).__demoImport;
  window.sessionStorage.clear();
});

describe("demo event push", () => {
  it("delivers the provider's events under their real names, with the state's presets merged", async () => {
    let push: (name: string, data: unknown) => void = () => undefined;
    const page = await boot({
      handleRequest: emptyResponse,
      subscribe: (listener) => { push = listener; return () => undefined; },
      eventSnapshot: async () => [["notifications", { notifications: [{ id: "n1" }] }]],
    });
    try {
      const source = page.source();
      const received: Record<string, unknown[]> = {};
      for (const name of ["orb-timer", "state", "notifications"]) {
        source.addEventListener(name, (event) => { (received[name] ??= []).push(JSON.parse(event.data)); });
      }
      await vi.waitFor(() => expect(received.notifications).toEqual([{ notifications: [{ id: "n1" }] }]));

      push("orb-timer", { timer: { id: "t1" } });
      push("state", { entities: [] });
      expect(received["orb-timer"]).toEqual([{ timer: { id: "t1" } }]);
      const state = received.state[0] as { controls?: unknown; controlModules?: unknown };
      expect(state.controls).toBeTruthy();
      expect(state.controlModules).toBeTruthy();

      source.close();
      push("orb-timer", { timer: null });
      expect(received["orb-timer"]).toHaveLength(1);
    } finally {
      page.restore();
    }
  });

  it("keeps working against a provider with no event push", async () => {
    const page = await boot({ handleRequest: emptyResponse });
    try {
      const source = page.source();
      const opened = vi.fn();
      source.addEventListener("open", opened as unknown as Listener);
      await vi.waitFor(() => expect(opened).toHaveBeenCalled());
      source.close();
    } finally {
      page.restore();
    }
  });
});
