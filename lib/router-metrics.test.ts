import { describe, expect, it } from "vitest";
import { normalizeDataRateToMegabytesPerSecond, selectRouterRateEntityId } from "./ha";
import type { HaState } from "./types";

describe("router data-rate normalization", () => {
  it("converts common Home Assistant router speed units to MB/s", () => {
    expect(normalizeDataRateToMegabytesPerSecond(216, "Mbit/s")).toBeCloseTo(27);
    expect(normalizeDataRateToMegabytesPerSecond(216, "Mbps")).toBeCloseTo(27);
    expect(normalizeDataRateToMegabytesPerSecond(27_000, "KB/s")).toBeCloseTo(27);
    expect(normalizeDataRateToMegabytesPerSecond(27_648, "KiB/s")).toBeCloseTo(27);
  });

  it("keeps already-normalized MB/s readings unchanged", () => {
    expect(normalizeDataRateToMegabytesPerSecond(27, "MB/s")).toBe(27);
  });

  /**
   * The configured id is the preference, full stop. This replaced a rule that
   * promoted a hard-coded "current" id over the configured one whenever the
   * configured one matched a hard-coded "legacy" id — which meant the product
   * carried one router model's sensor names and quietly overrode config. A home
   * that wants the newer sensor names it in config and lists the old one as a
   * fallback.
   */
  it("uses the configured sensor while it is reporting", () => {
    const states: HaState[] = [
      { entity_id: "sensor.router_rx", state: "27000", attributes: { unit_of_measurement: "KB/s" } },
      { entity_id: "sensor.router_download_speed", state: "0.1", attributes: { unit_of_measurement: "MB/s" } },
    ];

    expect(selectRouterRateEntityId(states, "sensor.router_rx", ["sensor.router_download_speed"])).toBe(
      "sensor.router_rx",
    );
  });

  it("falls back in order when the configured sensor stops reporting", () => {
    const states: HaState[] = [
      { entity_id: "sensor.router_rx", state: "unavailable", attributes: { unit_of_measurement: "KB/s" } },
      { entity_id: "sensor.router_download_speed", state: "29", attributes: { unit_of_measurement: "MB/s" } },
    ];

    expect(selectRouterRateEntityId(states, "sensor.router_rx", ["sensor.router_download_speed"])).toBe(
      "sensor.router_download_speed",
    );
  });

  it("keeps the configured sensor when nothing else is reporting either", () => {
    const states: HaState[] = [
      { entity_id: "sensor.router_rx", state: "unavailable", attributes: {} },
      { entity_id: "sensor.router_download_speed", state: "unknown", attributes: {} },
    ];

    expect(selectRouterRateEntityId(states, "sensor.router_rx", ["sensor.router_download_speed"])).toBe(
      "sensor.router_rx",
    );
  });

  it("works with no fallbacks configured at all", () => {
    const states: HaState[] = [
      { entity_id: "sensor.router_rx", state: "12", attributes: { unit_of_measurement: "MB/s" } },
    ];

    expect(selectRouterRateEntityId(states, "sensor.router_rx")).toBe("sensor.router_rx");
  });
});
