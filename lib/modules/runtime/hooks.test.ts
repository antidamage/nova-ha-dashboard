import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearModuleHooks,
  emitModuleEvent,
  registerEventHandler,
  registerInterceptHandler,
  runModuleIntercepts,
} from "./hooks";
import { renderTemplate } from "./template";
import type { InterceptContext, ModuleEvent } from "./types";

const CONTEXT: InterceptContext = {
  id: "entity.action",
  source: "server",
  entity: { id: "climate.unit", domain: "climate" },
  service: "turn_on",
};

function event(overrides: Partial<ModuleEvent> = {}): ModuleEvent {
  return {
    id: "thermostat.transition",
    at: "2026-08-28T19:42:07.000Z",
    source: "server",
    ...overrides,
  };
}

describe("server hook bus", () => {
  afterEach(() => {
    for (const id of ["a", "b", "slow", "bad"]) {
      clearModuleHooks(id);
    }
    vi.useRealTimers();
  });

  it("proceeds when nothing objects", async () => {
    await expect(runModuleIntercepts(CONTEXT)).resolves.toEqual({ decision: "proceed" });
  });

  it("stops at the first cancel and does not consult later interceptors", async () => {
    const later = vi.fn(() => "proceed" as const);
    registerInterceptHandler("a", "entity.action", () => "cancel");
    registerInterceptHandler("b", "entity.action", later);

    await expect(runModuleIntercepts(CONTEXT)).resolves.toEqual({ decision: "cancel", moduleId: "a" });
    expect(later).not.toHaveBeenCalled();
  });

  it("treats a confirm request from the server side as a cancel", async () => {
    // There is no user to ask on the server, and proceeding anyway would defeat
    // the point of asking. Fails closed.
    registerInterceptHandler("a", "entity.action", () => ({
      confirm: { stages: [{ title: "t", body: "b", confirmLabel: "go" }] },
    }));
    await expect(runModuleIntercepts(CONTEXT)).resolves.toEqual({ decision: "cancel", moduleId: "a" });
  });

  it("proceeds when an interceptor throws, rather than wedging the control", async () => {
    registerInterceptHandler("bad", "entity.action", () => {
      throw new Error("boom");
    });
    await expect(runModuleIntercepts(CONTEXT)).resolves.toEqual({ decision: "proceed" });
  });

  it("proceeds when an interceptor never settles", async () => {
    vi.useFakeTimers();
    registerInterceptHandler("slow", "entity.action", () => new Promise(() => {}));
    const pending = runModuleIntercepts(CONTEXT);
    await vi.advanceTimersByTimeAsync(5_100);
    await expect(pending).resolves.toEqual({ decision: "proceed" });
  });

  it("clears only the named module's hooks", async () => {
    registerInterceptHandler("a", "entity.action", () => "cancel");
    registerInterceptHandler("b", "entity.action", () => "proceed");
    clearModuleHooks("a");
    await expect(runModuleIntercepts(CONTEXT)).resolves.toEqual({ decision: "proceed" });
  });

  it("delivers events without letting a throwing handler stop the others", async () => {
    const good = vi.fn();
    registerEventHandler("bad", "thermostat.transition", () => {
      throw new Error("boom");
    });
    registerEventHandler("a", "thermostat.transition", good);

    emitModuleEvent(event());
    await Promise.resolve();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("message templates", () => {
  it("renders the convenience aliases", () => {
    const text = renderTemplate("{entity} turned {state} to {target}", event({
      entity: { id: "climate.unit", friendlyName: "Air conditioner", state: "on" },
      target: 22,
    }));
    expect(text).toBe("Air conditioner turned on to 22");
  });

  it("uses the event's own time, not the time of rendering", () => {
    const text = renderTemplate("{at}", event());
    expect(text).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("drops an unresolved placeholder and tidies the gap it leaves", () => {
    const text = renderTemplate("{entity} turned {state} — {reason}", event({
      entity: { id: "switch.heater", friendlyName: "Heater", state: "off" },
    }));
    expect(text).toBe("Heater turned off —");
  });

  it("treats an empty template as silence", () => {
    expect(renderTemplate("", event())).toBe("");
    expect(renderTemplate("   ", event())).toBe("");
  });

  it("reads dotted paths into the envelope", () => {
    const text = renderTemplate("{entity.previousState}->{entity.state}", event({
      entity: { id: "switch.heater", state: "off", previousState: "on" },
    }));
    expect(text).toBe("on->off");
  });
});
