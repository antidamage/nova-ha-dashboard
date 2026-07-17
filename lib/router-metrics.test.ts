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

  it("promotes the current TP-Link RX/TX sensor over the legacy default when both exist", () => {
    const states: HaState[] = [
      { entity_id: "sensor.nx620v_download_speed", state: "0.1", attributes: { unit_of_measurement: "MB/s" } },
      { entity_id: "sensor.nx620v_lte_current_rx_speed", state: "27000", attributes: { unit_of_measurement: "KB/s" } },
    ];

    expect(
      selectRouterRateEntityId(
        states,
        "sensor.nx620v_download_speed",
        "sensor.nx620v_lte_current_rx_speed",
        "sensor.nx620v_download_speed",
      ),
    ).toBe("sensor.nx620v_lte_current_rx_speed");
  });

  it("falls back to the legacy NX620v speed sensor when the current sensor is missing", () => {
    const states: HaState[] = [
      { entity_id: "sensor.nx620v_lte_current_rx_speed", state: "unavailable", attributes: { unit_of_measurement: "KB/s" } },
      { entity_id: "sensor.nx620v_download_speed", state: "29", attributes: { unit_of_measurement: "MB/s" } },
    ];

    expect(
      selectRouterRateEntityId(
        states,
        "sensor.nx620v_lte_current_rx_speed",
        "sensor.nx620v_lte_current_rx_speed",
        "sensor.nx620v_download_speed",
      ),
    ).toBe("sensor.nx620v_download_speed");
  });
});
