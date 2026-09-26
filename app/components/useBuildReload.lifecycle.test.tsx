import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Harness,
  dispatchVisibilityChange,
  getReloads,
  prepareBuildReloadTest,
  setVisibility,
  stubVersion,
} from "./useBuildReload.fixtures";
import { HIDDEN_RELOAD_GRACE_MS, getLastKnownBuildId, getRunningBuildId } from "./useBuildReload";

// The document-lifecycle half of the build-reload policy: the moments that are
// NOT a plain backgrounding, and what several mounted copies of the hook owe
// each other.

beforeEach(prepareBuildReloadTest);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Background the page, let a release land while it is away, then come back. */
async function deferAChangeAway(server: { buildId: string }) {
  setVisibility(true);
  dispatchVisibilityChange();
  const nextId = `${server.buildId}-next`;
  server.buildId = nextId;
  setVisibility(false);
  dispatchVisibilityChange();
  await waitFor(() => expect(getLastKnownBuildId()).toBe(nextId));
}

describe("useBuildReload lifecycle", () => {
  it("keeps one document's view across two mounted instances, and reloads once", async () => {
    // The shell mounts this hook more than once (the design host, Dashboard, the
    // accent config section). They describe one document, so the second copy must
    // not adopt a build the first is holding as deferred, and one hide must
    // produce one reload rather than one per copy.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("h1");
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    await waitFor(() => expect(getRunningBuildId()).toBe("h1"));

    await deferAChangeAway(server);
    expect(getRunningBuildId()).toBe("h1");

    setVisibility(true);
    dispatchVisibilityChange();
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(1);
  });

  it("does not reload when the hidden moment is really the document leaving", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("i1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("i1"));

    await deferAChangeAway(server);

    // The person clicks a link: hidden, then a terminal pagehide.
    setVisibility(true);
    dispatchVisibilityChange();
    window.dispatchEvent(new Event("pagehide"));

    await vi.advanceTimersByTimeAsync(5 * HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(0);
  });

  it("does not reload when the page comes straight back", async () => {
    // What enforces this is the scheduled reload's own re-check that the page is
    // still hidden when its grace expires.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("j1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("j1"));

    await deferAChangeAway(server);

    setVisibility(true); // away...
    dispatchVisibilityChange();
    setVisibility(false); // ...and back, inside the grace
    dispatchVisibilityChange();

    await vi.advanceTimersByTimeAsync(5 * HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(0);
    expect(getRunningBuildId()).toBe("j1");
  });

  it("defers a change across a bfcache freeze, which restores the page visible", async () => {
    // A guard rather than a pin: the hide before the freeze schedules the timer
    // and the freeze stops it, so this outcome is the timer's own re-check. What
    // the persisted pagehide adds is only the "this page has been away" mark.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisibility(false);
    const server = stubVersion("k1");
    render(<Harness />);
    await waitFor(() => expect(getLastKnownBuildId()).toBe("k1"));

    await deferAChangeAway(server);

    // The page is put into bfcache: hidden, then pagehide(persisted), then
    // FROZEN — so the grace timer scheduled by the hide cannot run while the page
    // is away. It fires on the way back instead, when the page is visible again,
    // which is exactly the re-check: no reload.
    setVisibility(true);
    dispatchVisibilityChange();
    const persisted = new Event("pagehide");
    Object.defineProperty(persisted, "persisted", { value: true });
    window.dispatchEvent(persisted);

    setVisibility(false); // restored, visible — the freeze did not run the timer
    dispatchVisibilityChange();
    await vi.advanceTimersByTimeAsync(5 * HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(0);
    expect(getRunningBuildId()).toBe("k1");

    // And the change is still applied the next time the page is left.
    setVisibility(true);
    dispatchVisibilityChange();
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_GRACE_MS);
    expect(getReloads()).toBe(1);
  });
});
