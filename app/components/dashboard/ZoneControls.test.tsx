import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardZone, RouterStatus } from "../../../lib/types";
import { REMOTE_SETTING_MIN_HOLD_MS, REMOTE_SETTING_SETTLE_MS } from "./useRemoteSetting";
import { ZoneControls } from "./ZoneControls";

type Hsva = { h: number; s: number; v: number; a: number };
type EncoderChannel = "hue" | "brightness" | "saturation" | "opacity";

type ColorEncoderProps = {
  disabled?: boolean;
  onActiveChannelChange?: (channel: EncoderChannel) => void;
  onChange: (value: Hsva) => void;
  onCommit?: (value: Hsva) => void;
  value: Hsva;
};

let latestEncoder: ColorEncoderProps | null = null;

vi.mock("../ColorEncoder", () => ({
  ColorEncoder: (props: ColorEncoderProps) => {
    latestEncoder = props;
    return <div aria-label="Zone lights" />;
  },
}));

/** Turns the zone dial on its brightness light, as a tap would. */
function selectChannel(channel: EncoderChannel) {
  act(() => {
    latestEncoder?.onActiveChannelChange?.(channel);
  });
}

function dialBrightness() {
  return latestEncoder?.value.v;
}

function setBrightness(value: number) {
  act(() => {
    latestEncoder?.onChange({ ...latestEncoder.value, v: value });
  });
}

function light(overrides: Partial<DashboardEntity> = {}): DashboardEntity {
  return {
    area_id: "lounge",
    attributes: { brightness: 255, rgb_color: [255, 200, 120] },
    domain: "light",
    entity_id: "light.lounge_light",
    name: "Lounge Light",
    state: "on",
    ...overrides,
  };
}

function loungeZone(overrides: Partial<DashboardZone> = {}): DashboardZone {
  return {
    brightnessPct: 100,
    counts: {
      climate: 0,
      cover: 0,
      fan: 0,
      humidifier: 0,
      light: 1,
      sensor: 0,
      switch: 0,
    },
    entities: [light()],
    id: "lounge",
    isOn: true,
    name: "Lounge",
    ...overrides,
  };
}

function networkZone(overrides: Partial<DashboardZone> = {}): DashboardZone {
  return {
    brightnessPct: 0,
    counts: {
      climate: 0,
      cover: 0,
      fan: 0,
      humidifier: 0,
      light: 0,
      sensor: 0,
      switch: 0,
    },
    entities: [],
    id: "network",
    isOn: false,
    name: "Network",
    ...overrides,
  };
}

function routerStatus(overrides: Partial<RouterStatus> = {}): RouterStatus {
  return {
    download: { display: "12 MB/s", entity_id: "sensor.router_down", unit: "MB/s", value: 12 },
    externalIp: "203.0.113.4",
    name: "Nova Router",
    upload: { display: "1 MB/s", entity_id: "sensor.router_up", unit: "MB/s", value: 1 },
    wanConnected: true,
    wanState: "Connected",
    ...overrides,
  };
}

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

function expectBefore(left: HTMLElement, right: HTMLElement) {
  expect(Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

describe("ZoneControls", () => {
  beforeEach(() => {
    latestEncoder = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps lounge controls ordered as the dial, its presets, then environment", () => {
    render(renderZoneControls(loungeZone()));

    const dial = screen.getByLabelText("Zone lights");
    const lightAction = screen.getByRole("button", { name: "White" });
    const environment = screen.getByRole("heading", { name: "Environment" });

    expectBefore(dial, lightAction);
    expectBefore(lightAction, environment);
    // The dial owns brightness: there is no second brightness control.
    expect(screen.queryByLabelText("Brightness")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sleep/i })).not.toBeInTheDocument();
  });

  it("shows managed desktop sleep buttons in the network zone", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/desktop/computers")) {
        return {
          json: async () => ({
            computers: [
              {
                capabilities: { sleep: true, wallpaper: true },
                enabled: true,
                id: "studio-desktop",
                name: "Studio Desktop",
              },
            ],
          }),
          ok: true,
        };
      }
      return {
        json: async () => routerStatus(),
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(renderZoneControls(networkZone()));

    expect(screen.getByText("Network Interface")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sleep Studio Desktop" })).toBeInTheDocument());
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

  it("sends lighting commands only when the control is released, not while dragging", () => {
    const onZoneAction = vi.fn(async () => undefined);
    render(renderZoneControls(loungeZone(), onZoneAction));

    // Turning the dial on its brightness light previews locally, sends nothing.
    selectChannel("brightness");
    setBrightness(80);
    expect(onZoneAction).not.toHaveBeenCalled();

    // Releasing sends the brightness command once.
    act(() => {
      latestEncoder?.onCommit?.({ ...latestEncoder.value, v: 80 });
    });
    expect(onZoneAction).toHaveBeenCalledWith("brightness", { brightnessPct: 80 });

    onZoneAction.mockClear();

    // Turning it on the hue light previews locally, sends nothing.
    selectChannel("hue");
    act(() => {
      latestEncoder?.onChange({ h: 30, s: 67, v: 80, a: 100 });
    });
    expect(onZoneAction).not.toHaveBeenCalled();

    // Releasing sends one colour command: rgb at full value, level as brightness.
    act(() => {
      latestEncoder?.onCommit?.({ h: 30, s: 67, v: 80, a: 100 });
    });
    expect(onZoneAction).toHaveBeenCalledWith("color", expect.objectContaining({
      brightnessPct: 80,
      rgb: [255, 170, 84],
    }));
  });

  it("does not send colour changes while every light in the zone is off", () => {
    const onZoneAction = vi.fn(async () => undefined);
    render(renderZoneControls(loungeZone({
      brightnessPct: 0,
      entities: [light({ attributes: { brightness: 0 }, state: "off" })],
      isOn: false,
    }), onZoneAction));

    selectChannel("hue");
    act(() => {
      latestEncoder?.onChange({ h: 200, s: 50, v: 0, a: 100 });
      latestEncoder?.onCommit?.({ h: 200, s: 50, v: 0, a: 100 });
    });
    expect(onZoneAction).not.toHaveBeenCalled();

    // Brightness still works with the zone off: raising it is how it comes on.
    selectChannel("brightness");
    act(() => {
      latestEncoder?.onCommit?.({ h: 200, s: 50, v: 60, a: 100 });
    });
    expect(onZoneAction).toHaveBeenCalledWith("brightness", { brightnessPct: 60 });
  });
});
