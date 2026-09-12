import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardZone } from "../../../lib/types";
import { OutsideControls } from "./OutsideControls";

// The knob and the camera are not what these assert, and both are heavy to
// mount (a canvas and an hls.js player).
vi.mock("./ZoneControls", () => ({
  ZoneColorEncoder: () => <div aria-label="Outside lights" />,
}));
vi.mock("./CameraPanel", () => ({ CameraPanel: () => <div data-testid="camera" /> }));
vi.mock("./WeatherPanel", () => ({ WeatherPanel: () => <div data-testid="weather" /> }));

function light(state: string): DashboardEntity {
  return {
    entity_id: "light.outside_light",
    domain: "light",
    state,
    attributes: {},
  } as unknown as DashboardEntity;
}

function zoneWith(state: string): DashboardZone {
  return {
    id: "outside",
    name: "Outside",
    entities: [light(state)],
    counts: {},
  } as unknown as DashboardZone;
}

afterEach(cleanup);

describe("the Outside light", () => {
  it("commands full white on every On, whatever the knob was left on", () => {
    const onZoneAction = vi.fn().mockResolvedValue(undefined);
    render(<OutsideControls zone={zoneWith("off")} weather={null} onZoneAction={onZoneAction} />);

    fireEvent.click(screen.getByRole("button", { name: /Outside light on/ }));

    // Not a bare turn_on: the white preset, at full brightness
    // (specs/outside-card.md).
    expect(onZoneAction).toHaveBeenCalledTimes(1);
    const [action, body] = onZoneAction.mock.calls[0];
    expect(action).toBe("white");
    expect(body).toMatchObject({ brightnessPct: 100, rgb: [255, 255, 255] });
  });

  it("turns the zone off", () => {
    const onZoneAction = vi.fn().mockResolvedValue(undefined);
    render(<OutsideControls zone={zoneWith("on")} weather={null} onZoneAction={onZoneAction} />);

    fireEvent.click(screen.getByRole("button", { name: /Outside light off/ }));

    expect(onZoneAction).toHaveBeenCalledWith("off");
  });

  it("puts the light, the weather and the camera in that order", () => {
    const { container } = render(
      <OutsideControls zone={zoneWith("on")} weather={null} onZoneAction={vi.fn().mockResolvedValue(undefined)} />,
    );
    const grid = container.querySelector(".outside-control-grid");
    const order = [...(grid?.children ?? [])].map((child) =>
      child.classList.contains("outside-light-card")
        ? "light"
        : child.getAttribute("data-testid") ?? "other");
    expect(order).toEqual(["light", "weather", "camera"]);
  });
});
