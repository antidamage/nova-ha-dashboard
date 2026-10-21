import { act } from "@testing-library/react";
import { expect } from "vitest";
import type { DashboardEntity, DashboardZone, RouterStatus } from "../../../../lib/types";

/*
 * Shared by the ZoneControls*.test.tsx files. Each of them mocks
 * ../../LightEncoder with MockColorEncoder below, which records the props the
 * zone dial was last rendered with so a test can turn it. This file must not
 * import ZoneControls (or anything that imports LightEncoder): the mock factory
 * loads it, and a cycle through the mocked module would never resolve.
 */

export type Hsva = { h: number; s: number; v: number; a: number };
export type EncoderChannel = "hue" | "brightness" | "saturation" | "opacity";

export type ColorEncoderProps = {
  disabled?: boolean;
  onActiveChannelChange?: (channel: EncoderChannel) => void;
  onChange: (value: Hsva) => void;
  onCommit?: (value: Hsva) => void;
  value: Hsva;
};

export let latestEncoder: ColorEncoderProps | null = null;

export function resetLatestEncoder() {
  latestEncoder = null;
}

export function MockColorEncoder(props: ColorEncoderProps) {
  latestEncoder = props;
  return <div aria-label="Zone lights" />;
}

/** Turns the zone dial on its brightness light, as a tap would. */
export function selectChannel(channel: EncoderChannel) {
  act(() => {
    latestEncoder?.onActiveChannelChange?.(channel);
  });
}

export function dialBrightness() {
  return latestEncoder?.value.v;
}

export function setBrightness(value: number) {
  act(() => {
    latestEncoder?.onChange({ ...latestEncoder.value, v: value });
  });
}

export function light(overrides: Partial<DashboardEntity> = {}): DashboardEntity {
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

export function loungeZone(overrides: Partial<DashboardZone> = {}): DashboardZone {
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

export function networkZone(overrides: Partial<DashboardZone> = {}): DashboardZone {
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

export function routerStatus(overrides: Partial<RouterStatus> = {}): RouterStatus {
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

export function expectBefore(left: HTMLElement, right: HTMLElement) {
  expect(Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}
