import { describe, expect, it } from "vitest";
import type { DashboardConfig } from "../../config-schema";
import type { HaState } from "../../types";
import { buildRouterStatus, routerModule } from "./module";

function state(entity_id: string, value: string, unit?: string): HaState {
  return {
    entity_id,
    state: value,
    attributes: unit ? { unit_of_measurement: unit } : {},
  } as HaState;
}

const router = {
  name: "Home Router",
  wanStatusEntityId: "binary_sensor.wan",
  externalIpEntityId: "sensor.external_ip",
  downloadSpeedEntityId: "sensor.download",
  uploadSpeedEntityId: "sensor.upload",
};

const config = { homeAssistant: { router } } as unknown as DashboardConfig;

describe("buildRouterStatus", () => {
  it("reports connection, IP, and formatted throughput", () => {
    const status = buildRouterStatus(
      [
        state("binary_sensor.wan", "on"),
        state("sensor.external_ip", "203.0.113.7"),
        state("sensor.download", "27", "MB/s"),
        state("sensor.upload", "5.5", "MB/s"),
      ],
      config,
    );
    expect(status.wanConnected).toBe(true);
    expect(status.wanState).toBe("Connected");
    expect(status.externalIp).toBe("203.0.113.7");
    expect(status.download.display).toBe("27 MB/s"); // >=10 -> no decimals
    expect(status.upload.display).toBe("5.5 MB/s"); // >=0.1 -> one decimal
  });

  it("formats sub-unit speeds with three decimals and zero as 0.0", () => {
    const status = buildRouterStatus(
      [state("sensor.download", "0.05", "MB/s"), state("sensor.upload", "0", "MB/s")],
      config,
    );
    expect(status.download.display).toBe("0.050 MB/s");
    expect(status.upload.display).toBe("0.0 MB/s");
  });

  it("shows -- for missing or non-numeric speed sensors", () => {
    const status = buildRouterStatus([state("sensor.download", "unavailable")], config);
    expect(status.download.value).toBeNull();
    expect(status.download.display).toBe("--");
  });

  it("treats a missing WAN sensor as unknown", () => {
    const status = buildRouterStatus([], config);
    expect(status.wanConnected).toBeNull();
    expect(status.wanState).toBe("Unknown");
    expect(status.externalIp).toBe("--");
  });

  it("reports a disconnected WAN", () => {
    const status = buildRouterStatus([state("binary_sensor.wan", "off")], config);
    expect(status.wanConnected).toBe(false);
    expect(status.wanState).toBe("Disconnected");
  });
});

describe("routerModule.status", () => {
  it("is active when at least one required sensor exists", () => {
    const status = routerModule.status!({ config, states: [state("binary_sensor.wan", "on")] } as never);
    expect(status.active).toBe(true);
    expect(status.summary).toContain("Home Router");
  });

  it("is inactive when no router sensors exist", () => {
    const status = routerModule.status!({ config, states: [] } as never);
    expect(status.active).toBe(false);
    expect(status.requirements?.every((r) => !r.ok)).toBe(true);
  });
});
