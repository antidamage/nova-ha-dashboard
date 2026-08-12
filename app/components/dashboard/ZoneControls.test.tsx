import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardZone, RouterStatus } from "../../../lib/types";
import { REMOTE_SETTING_MIN_HOLD_MS, REMOTE_SETTING_SETTLE_MS } from "./useRemoteSetting";
import { ZoneControls } from "./ZoneControls";

type DotLineControlProps = {
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  value: number;
};

type DotSpectrumControlProps = {
  disabled?: boolean;
  onChange: (cursor: { x: number; y: number }, rgb: [number, number, number]) => void;
  onCommit?: (cursor: { x: number; y: number }, rgb: [number, number, number]) => void;
};

let latestLineControl: DotLineControlProps | null = null;
let latestSpectrumControl: DotSpectrumControlProps | null = null;

vi.mock("../DotControls", () => ({
  DotLineControl: (props: DotLineControlProps) => {
    latestLineControl = props;
    return <div aria-label="Brightness" />;
  },
  DotSpectrumControl: (props: DotSpectrumControlProps) => {
    latestSpectrumControl = props;
    return <div aria-label="Zone color spectrum" />;
  },
}));

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
    latestLineControl = null;
    latestSpectrumControl = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps lounge controls ordered as lighting, intensity, then environment", () => {
    render(renderZoneControls(loungeZone()));

    const lightAction = screen.getByRole("button", { name: "White" });
    const spectrum = screen.getByText("Spectrum");
    const intensity = screen.getByText("Intensity");
    const environment = screen.getByRole("heading", { name: "Environment" });

    expectBefore(lightAction, spectrum);
    expectBefore(spectrum, intensity);
    expectBefore(intensity, environment);
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

    expect(latestLineControl?.value).toBe(100);

    act(() => {
      latestLineControl?.onChange(40);
    });
    expect(latestLineControl?.value).toBe(40);

    // Mid-fade zone averages keep arriving and must never reach the control,
    // however long the fade takes.
    for (const fadingPct of [100, 92, 78, 61, 49]) {
      rerender(renderZoneControls(loungeZone({ brightnessPct: fadingPct })));
      act(() => {
        vi.advanceTimersByTime(REMOTE_SETTING_SETTLE_MS - 1);
      });
      expect(latestLineControl?.value).toBe(40);
    }

    // Arrived: a fixture settling a point off still reads as the set value.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 39 })));
    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_MIN_HOLD_MS + REMOTE_SETTING_SETTLE_MS);
    });
    expect(latestLineControl?.value).toBe(40);
  });

  it("adopts a brightness change made elsewhere once it settles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));

    const { rerender } = render(renderZoneControls(loungeZone({ brightnessPct: 100 })));

    act(() => {
      latestLineControl?.onChange(40);
    });
    expect(latestLineControl?.value).toBe(40);

    // Something else set the zone to 80 and it stays there.
    rerender(renderZoneControls(loungeZone({ brightnessPct: 80 })));
    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_SETTLE_MS);
    });
    expect(latestLineControl?.value).toBe(40);

    act(() => {
      vi.advanceTimersByTime(REMOTE_SETTING_MIN_HOLD_MS);
    });
    expect(latestLineControl?.value).toBe(80);
  });

  it("sends lighting commands only when the control is released, not while dragging", () => {
    const onZoneAction = vi.fn(async () => undefined);
    render(renderZoneControls(loungeZone(), onZoneAction));

    // Dragging the brightness slider previews locally but sends nothing.
    act(() => {
      latestLineControl?.onChange(80);
    });
    expect(onZoneAction).not.toHaveBeenCalled();

    // Releasing the slider sends the brightness command once.
    act(() => {
      latestLineControl?.onCommit?.(80);
    });
    expect(onZoneAction).toHaveBeenCalledWith("brightness", { brightnessPct: 80 });

    onZoneAction.mockClear();

    // Dragging the spectrum previews locally but sends nothing.
    act(() => {
      latestSpectrumControl?.onChange({ x: 0.4, y: 0.5 }, [120, 80, 40]);
    });
    expect(onZoneAction).not.toHaveBeenCalled();

    // Releasing the spectrum sends the colour command once.
    act(() => {
      latestSpectrumControl?.onCommit?.({ x: 0.4, y: 0.5 }, [120, 80, 40]);
    });
    expect(onZoneAction).toHaveBeenCalledWith("color", expect.objectContaining({ rgb: [120, 80, 40] }));
  });

  it("does not send colour changes while every light in the zone is off", () => {
    const onZoneAction = vi.fn(async () => undefined);
    render(renderZoneControls(loungeZone({
      brightnessPct: 0,
      entities: [light({ attributes: { brightness: 0 }, state: "off" })],
      isOn: false,
    }), onZoneAction));

    expect(latestSpectrumControl?.disabled).toBe(true);

    act(() => {
      latestSpectrumControl?.onChange({ x: 0.2, y: 0.3 }, [10, 20, 30]);
      latestSpectrumControl?.onCommit?.({ x: 0.2, y: 0.3 }, [10, 20, 30]);
    });

    expect(onZoneAction).not.toHaveBeenCalled();
  });
});
