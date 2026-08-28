import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleHost, useModuleIntercepts } from "./ModuleHost";
import { ModuleSlot } from "./ModuleSlot";
import type { InterceptDecision, ModuleSummary } from "../../../lib/modules/runtime/types";

/**
 * The module system's client half, exercised end to end short of a browser.
 *
 * The e2e suite runs the dashboard in demo mode, which is a static export with
 * no `/api/modules` to ask, so `ModuleHost` is deliberately inert there. These
 * tests are where the slot rendering and the confirm-interceptor flow are
 * actually covered.
 */

const summary: ModuleSummary = {
  id: "fixture-module",
  name: "Fixture",
  version: "1.0.0",
  description: "",
  enabled: true,
  state: "loaded",
  hooks: ["card.body.after", "entity.action"],
  hasClient: true,
  hasServer: false,
  clientVersion: "1",
  secrets: [],
};

type Registrar = (api: {
  slot: (id: string, render: (context: Record<string, unknown>) => unknown) => void;
  intercept: (id: string, handler: () => InterceptDecision | Promise<InterceptDecision>) => void;
  jsx: (type: unknown, props: unknown, key?: unknown) => unknown;
}) => void;

let register: Registrar = () => {};
let modules: ModuleSummary[] = [summary];

// The real host imports the module's bundle from an API route. There is no URL
// loader under vitest, so the import is stubbed and everything else — the
// registration API, the slot table, the confirm dialog — runs for real.
vi.mock("./moduleImport", () => ({
  importModuleClient: async () => ({ default: { register: (api: never) => register(api) } }),
}));

function Harness() {
  const runIntercepts = useModuleIntercepts();
  return (
    <div>
      <ModuleSlot id="card.body.after" context={{ cardId: "aircon" }} />
      <button
        type="button"
        onClick={async () => {
          const ok = await runIntercepts({ id: "entity.action", source: "client" });
          const target = document.getElementById("outcome");
          if (target) {
            target.textContent = ok ? "ran" : "blocked";
          }
        }}
      >
        Do the thing
      </button>
      <p id="outcome">pending</p>
    </div>
  );
}

describe("ModuleHost", () => {
  beforeEach(() => {
    modules = [summary];
    register = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/modules")) {
          return new Response(JSON.stringify({ modules }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a module's contribution into the slot it registered for", async () => {
    register = (api) => {
      api.slot("card.body.after", (context) =>
        api.jsx("span", { children: `hello from ${String(context.cardId)}` }),
      );
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );

    await waitFor(() => expect(screen.getByText("hello from aircon")).toBeTruthy());
  });

  it("renders nothing for a slot no module registered for", async () => {
    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());
    expect(screen.queryByText(/hello from/)).toBeNull();
  });

  it("blocks the action when an interceptor cancels", async () => {
    register = (api) => {
      api.intercept("entity.action", () => "cancel");
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());

    fireEvent.click(screen.getByText("Do the thing"));
    await waitFor(() => expect(screen.getByText("blocked")).toBeTruthy());
  });

  it("asks through the shared dialog and runs the action when confirmed", async () => {
    const confirmed = vi.fn();
    register = (api) => {
      api.intercept("entity.action", () => ({
        confirm: {
          stages: [{ title: "Turn the aircon on?", body: "It is late.", confirmLabel: "Yes, do it" }],
          onConfirmed: confirmed,
        },
      }));
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());

    fireEvent.click(screen.getByText("Do the thing"));
    await waitFor(() => expect(screen.getByText("Turn the aircon on?")).toBeTruthy());
    // Nothing has happened yet — the dialog is the gate, not a notification.
    expect(screen.getByText("pending")).toBeTruthy();

    fireEvent.click(screen.getByText("Yes, do it"));
    await waitFor(() => expect(screen.getByText("ran")).toBeTruthy());
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it("does not run the action when the confirmation is cancelled", async () => {
    const cancelled = vi.fn();
    register = (api) => {
      api.intercept("entity.action", () => ({
        confirm: {
          stages: [{ title: "Are you sure?", body: "b", confirmLabel: "Go" }],
          onCancelled: cancelled,
        },
      }));
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());

    fireEvent.click(screen.getByText("Do the thing"));
    await waitFor(() => expect(screen.getByText("Are you sure?")).toBeTruthy());
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.getByText("blocked")).toBeTruthy());
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("survives a module that throws while rendering a slot", async () => {
    register = (api) => {
      api.slot("card.body.after", () => {
        throw new Error("module is broken");
      });
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );

    // The dashboard around it still renders.
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());
  });

  it("ignores a disabled module", async () => {
    modules = [{ ...summary, enabled: false }];
    register = (api) => {
      api.slot("card.body.after", () => api.jsx("span", { children: "should not appear" }));
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );

    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());
    expect(screen.queryByText("should not appear")).toBeNull();
  });

  it("refuses a hook the module did not declare in its manifest", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    register = (api) => {
      api.slot("clock.after", () => api.jsx("span", { children: "undeclared" }));
    };

    render(
      <ModuleHost>
        <Harness />
      </ModuleHost>,
    );

    await waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(screen.queryByText("undeclared")).toBeNull();
  });
});
