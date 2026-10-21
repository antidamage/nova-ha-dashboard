import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardZone } from "../../../../lib/types";
import { REMOTE_SETTING_MIN_HOLD_MS, REMOTE_SETTING_SETTLE_MS } from "../useRemoteSetting";
import { ZoneControls } from "../ZoneControls";
import {
  dialBrightness,
  loungeZone,
  resetLatestEncoder,
  routerStatus,
  selectChannel,
  setBrightness,
} from "./ZoneControls.fixtures";

vi.mock("../../LightEncoder", async () => {
  const { MockColorEncoder } = await import("./ZoneControls.fixtures");
  return { LightEncoder: MockColorEncoder };
});

function renderZoneControls(zone: DashboardZone, onZoneAction = vi.fn(async () => undefined)) {
  return (
    <Tooltip.Provider>
      <ZoneControls
        zone={zone}
        loungeEnvironment={{ humidity: 55, temperature: 21.5 }}
        onDesktopSleep={vi.fn()}
        onEntityActions={vi.fn(async () => undefined)}
        onZoneAction={onZoneAction}
        router={routerStatus()}
      />
    </Tooltip.Provider>
  );
}


describe("ZoneControls", () => {
  beforeEach(() => {
    resetLatestEncoder();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the set brightness while the zone fades toward it, never the fade", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));

    const { rerender } = render(renderZoneControls(loungeZone({ brightnessPct: 100 })));

    expect(dialBrightness()).toBe(100);

    selectChannel("brightness");
    setBrightness(40);
    expect(dialBrightness()).toBe(40);

    // Mid-fade zone averages keep arriving and must never reach the control,
    // however long the fade takes.
    for (const fadingPct of [100, 92, 78, 61, 49]) {
      rerender(renderZoneControls(loungeZone({ brightnessPct: fadingPct })));
      act(() => {
        vi.advanceTimersByTime(REMOTE_SETTING_SETTLE_MS - 1);
      });
      expect(dialBrightness()).toBe(40);
    }

    // Arrived: a fixture settling a point off still reads as the set value.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 39 })));
    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_MIN_HOLD_MS + REMOTE_SETTING_SETTLE_MS);
    });
    expect(dialBrightness()).toBe(40);
  });

  it("shows where a transition is going, not the fade, on a client that did not command it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));

    // Another client set this zone to 25%: the server says the reading is mid
    // transition and publishes the target. Nothing was set locally here.
    const { rerender } = render(
      renderZoneControls(loungeZone({ brightnessPct: 88, brightnessTransition: { targetPct: 25 } })),
    );
    expect(dialBrightness()).toBe(25);

    // Later waypoints of the same fade change nothing.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 61, brightnessTransition: { targetPct: 25 } })));
    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_MIN_HOLD_MS + REMOTE_SETTING_SETTLE_MS);
    });
    expect(dialBrightness()).toBe(25);

    // Transition over: the settled reading is a result and is taken as one.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 25 })));
    expect(dialBrightness()).toBe(25);
  });

  it("never gives up a locally set value to a transitional reading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));

    const { rerender } = render(renderZoneControls(loungeZone({ brightnessPct: 100 })));

    selectChannel("brightness");
    setBrightness(40);

    // A long, slow fade reporting a stable-looking waypoint must not accrue
    // settle time toward replacing what was entered.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 70, brightnessTransition: { targetPct: 40 } })));
    act(() => {
      vi.advanceTimersByTime((REMOTE_SETTING_MIN_HOLD_MS + REMOTE_SETTING_SETTLE_MS) * 3);
    });
    expect(dialBrightness()).toBe(40);
  });

  it("adopts a brightness change made elsewhere once it settles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));

    const { rerender } = render(renderZoneControls(loungeZone({ brightnessPct: 100 })));

    selectChannel("brightness");
    setBrightness(40);
    expect(dialBrightness()).toBe(40);

    // Something else set the zone to 80 and it stays there.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 80 })));
    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_SETTLE_MS);
    });
    expect(dialBrightness()).toBe(40);

    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_MIN_HOLD_MS);
    });
    expect(dialBrightness()).toBe(80);
  });
});
