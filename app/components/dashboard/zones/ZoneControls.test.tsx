import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardZone } from "../../../../lib/types";
import { ZoneControls } from "../ZoneControls";
import { openAdvancedFold } from "../advancedFoldTesting";
import {
  expectBefore,
  latestEncoder,
  light,
  loungeZone,
  networkZone,
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

  it("keeps lounge controls ordered as the dial, its presets, then environment", () => {
    // Environment is a readout, so it sits below the Advanced line now
    // (specs/advanced-fold.md); the dial and its presets stay in the default view.
    const { container } = render(renderZoneControls(loungeZone()));

    const dial = screen.getByLabelText("Zone lights");
    const lightAction = screen.getByRole("button", { name: "White" });
    expect(screen.queryByRole("heading", { name: "Environment" })).not.toBeInTheDocument();

    openAdvancedFold(container);
    const environment = screen.getByRole("heading", { name: "Environment" });

    expectBefore(dial, lightAction);
    expectBefore(lightAction, environment);
    // The dial owns brightness: there is no second brightness control.
    expect(screen.queryByLabelText("Brightness")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sleep/i })).not.toBeInTheDocument();
  });

  it("keeps House Party as an inline label beside its labelled switch", () => {
    const { container } = render(renderZoneControls(loungeZone()));

    openAdvancedFold(container);

    expect(screen.queryByRole("heading", { name: "House Party" })).not.toBeInTheDocument();
    expect(screen.getByText("House Party")).toHaveClass("zone-party-control-label");
    const toggle = screen.getByRole("switch", { name: "House Party" });
    const switchRow = toggle.closest(".climate-switch-row") as HTMLElement;
    expect(switchRow).toHaveTextContent("Off");
    expect(switchRow).toHaveTextContent("On");
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
