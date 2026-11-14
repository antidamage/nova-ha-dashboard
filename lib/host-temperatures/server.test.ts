import { describe, expect, it, vi } from "vitest";
import type { DashboardConfig } from "../config-schema";
import { configuredSources, hostTemperatures } from "./server";

vi.mock("../control-modules/stored", () => ({
  storedPresets: (config: { presets: unknown[] }) => config.presets,
}));

const config = {
  presets: [
    { id: "temps", moduleId: "host-temperatures", binding: { metricSources: ["A=http://a.example/flat", "B=http://b.example/flat"] } },
    { id: "other", moduleId: "outside-weather", binding: { metricSources: ["X=http://x.example/flat"] } },
  ],
} as unknown as DashboardConfig;

describe("host temperatures on the server", () => {
  it("only ever fetches URLs saved in a Host Temperatures preset", async () => {
    expect(configuredSources(config).map((s) => s.url)).toEqual(["http://a.example/flat", "http://b.example/flat"]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("b.example")) throw new Error("asleep");
      return new Response(JSON.stringify({ "temp.cpu.celsius": 70, "temp.gpu.celsius": 50 }));
    }) as unknown as typeof fetch;
    const body = await hostTemperatures({ config, fetchImpl, now: 1 });
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])).toEqual([
      "http://a.example/flat",
      "http://b.example/flat",
    ]);
    expect(body.sources).toEqual([
      {
        label: "A",
        url: "http://a.example/flat",
        ok: true,
        readings: [
          { key: "temp.cpu.celsius", part: "CPU", celsius: 70 },
          { key: "temp.gpu.celsius", part: "GPU", celsius: 50 },
        ],
      },
      { label: "B", url: "http://b.example/flat", ok: false, readings: [] },
    ]);
  });
});
