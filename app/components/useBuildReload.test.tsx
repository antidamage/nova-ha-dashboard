import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeEventSource,
  Harness,
  dispatchVisibilityChange,
  getReloads,
  lastAutoReload,
  prepareBuildReloadTest,
  setVisibility,
  stubVersion,
} from "./useBuildReload.fixtures";
import {
  HIDDEN_RELOAD_GRACE_MS,
  decideBuildReload,
  getLastKnownBuildId,
  getRunningBuildId,
} from "./useBuildReload";

beforeEach(prepareBuildReloadTest);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("decideBuildReload", () => {
  it("adopts the first id it has ever seen, hidden or not", () => {
    expect(decideBuildReload({ pageBuildId: null, serverBuildId: "b1", hidden: false, hasBeenHidden: false })).toBe("adopt");
    expect(decideBuildReload({ pageBuildId: null, serverBuildId: "b1", hidden: true, hasBeenHidden: true })).toBe("adopt");
  });

  it("ignores an unreadable server id", () => {
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: null, hidden: true, hasBeenHidden: true })).toBe("none");
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: "", hidden: false, hasBeenHidden: false })).toBe("none");
  });

  it("does nothing while the build is unchanged", () => {
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: "b1", hidden: false, hasBeenHidden: true })).toBe("none");
  });

  it("defers for a page that has been hidden at some point, however long it has been back", () => {
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: "b2", hidden: false, hasBeenHidden: true })).toBe("defer");
  });

  it("reloads for a build change nobody is looking at", () => {
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: "b2", hidden: true, hasBeenHidden: true })).toBe("reload");
  });

  it("keeps reloading a page that has never been hidden, so the kiosk still updates", () => {
    expect(decideBuildReload({ pageBuildId: "b1", serverBuildId: "b2", hidden: false, hasBeenHidden: false })).toBe("reload");
  });
});

describe("useBuildReload", () => {
  it("does not reload a page returning to a build that changed while it was away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("b1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("b1"));
    expect(getReloads()).toBe(0);

    setVisibility(true);
    dispatchVisibilityChange(); // it is backgrounded
    server.buildId = "b2"; // a release lands while it is away

    setVisibility(false);
    dispatchVisibilityChange(); // it comes back
    await waitFor(() => expect(getLastKnownBuildId()).toBe("b2"));
    expect(getReloads()).toBe(0);
    expect(lastAutoReload()).toBeNull();

    setVisibility(true);
    dispatchVisibilityChange(); // it is left again: now the build is applied
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(1);
    expect(lastAutoReload()).toMatchObject({ reason: "build-change", trigger: "hidden", from: "b1", to: "b2" });
  });

  it("reloads off-screen, a moment after it goes, when it is hidden and learns of a change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(true);
    const server = stubVersion("c1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("c1"));

    server.buildId = "c2";
    FakeEventSource.emitAll("build", JSON.stringify({ buildId: "c2" }));

    expect(getReloads()).toBe(0); // scheduled, not issued: the hide may be the document leaving
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_GRACE_MS);

    expect(getReloads()).toBe(1);
    expect(lastAutoReload()).toMatchObject({ trigger: "hidden", from: "c1", to: "c2" });
  });

  it("still reloads a page that never left, so the kiosk keeps picking up builds", async () => {
    setVisibility(false);
    const server = stubVersion("d1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("d1"));

    server.buildId = "d2";
    FakeEventSource.emitAll("build", JSON.stringify({ buildId: "d2" }));

    expect(getReloads()).toBe(1);
    expect(lastAutoReload()).toMatchObject({ trigger: "visible", from: "d1", to: "d2" });
  });

  it("reports how long a deferred build has been waiting, across polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("m1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("m1"));

    setVisibility(true);
    dispatchVisibilityChange();
    server.buildId = "m2";
    setVisibility(false);
    dispatchVisibilityChange(); // deferred: m2
    await waitFor(() => expect(getLastKnownBuildId()).toBe("m2"));

    // Two more polls re-deliver the same superseded id, then a release lands on
    // top of it. The deferral's age is the thing a display that keeps deferring
    // has to be able to report, so it must survive both.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    server.buildId = "m3";
    await vi.advanceTimersByTimeAsync(60_000);

    setVisibility(true);
    dispatchVisibilityChange();
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_GRACE_MS);

    expect(getReloads()).toBe(1);
    const record = lastAutoReload();
    expect(record.to).toBe("m3");
    expect(record.deferredForMs).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("counts a frozen-to-bfcache page as one that has been away", async () => {
    // A platform that puts the page into bfcache without a hidden tick first:
    // pagehide with persisted, and the document still reported visible.
    setVisibility(false);
    const server = stubVersion("n1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("n1"));

    const persisted = new Event("pagehide");
    Object.defineProperty(persisted, "persisted", { value: true });
    window.dispatchEvent(persisted);

    // From here it counts as a page that has been away, so a change learned while
    // it is on screen is deferred rather than applied in front of someone.
    server.buildId = "n2";
    FakeEventSource.emitAll("build", JSON.stringify({ buildId: "n2" }));
    await waitFor(() => expect(getLastKnownBuildId()).toBe("n2"));

    expect(getReloads()).toBe(0);
  });

  it("reloads a visible page once, not once per mounted copy", async () => {
    setVisibility(false);
    const server = stubVersion("l1");
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    await waitFor(() => expect(getLastKnownBuildId()).toBe("l1"));

    server.buildId = "l2";
    FakeEventSource.emitAll("build", JSON.stringify({ buildId: "l2" }));

    expect(getReloads()).toBe(1);
  });

  it("drops a deferred change when the server comes back to the build we run", async () => {
    setVisibility(false);
    const server = stubVersion("e1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("e1"));

    setVisibility(true);
    dispatchVisibilityChange();
    server.buildId = "e2";
    setVisibility(false);
    dispatchVisibilityChange(); // deferred: e2
    await waitFor(() => expect(getLastKnownBuildId()).toBe("e2"));

    // A rollback: the server is serving e1 again. Delivered on the SSE path, so
    // the page has heard it BEFORE it is next hidden.
    FakeEventSource.emitAll("build", JSON.stringify({ buildId: "e1" }));

    setVisibility(true);
    dispatchVisibilityChange(); // must NOT apply the stale e2

    expect(getReloads()).toBe(0);
    expect(getRunningBuildId()).toBe("e1");
  });

  it("reports the build this page is running, for the outage blocker", async () => {
    setVisibility(false);
    const server = stubVersion("f1");
    render(<Harness />);
    await waitFor(() => expect(getRunningBuildId()).toBe("f1"));

    setVisibility(true);
    dispatchVisibilityChange();
    server.buildId = "f2";
    setVisibility(false);
    dispatchVisibilityChange();
    await waitFor(() => expect(getLastKnownBuildId()).toBe("f2"));
    // A deferred change is not applied, so the page is still running f1.
    expect(getRunningBuildId()).toBe("f1");
  });
});

describe("stylesheet cache-breaker", () => {
  it("busts the cache for the build this page runs, and never for a foreign one", async () => {
    setVisibility(false);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "http://localhost/_next/static/css/app.css";
    document.head.append(link);

    const server = stubVersion("g1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("g1"));
    expect(link.href).toContain("v=g1");

    setVisibility(true);
    dispatchVisibilityChange();
    server.buildId = "g2";
    setVisibility(false);
    dispatchVisibilityChange();
    await waitFor(() => expect(getLastKnownBuildId()).toBe("g2"));

    expect(link.href).toContain("v=g1");
    expect(link.href).not.toContain("v=g2");
  });
});
