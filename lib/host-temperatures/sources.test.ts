import { describe, expect, it } from "vitest";
import { gaugeFraction, gaugeIsHot, parseMetricSources, readingsFromFlat } from "./sources";

describe("parseMetricSources", () => {
  it("reads Label=URL tokens in order and drops malformed ones", () => {
    expect(
      parseMetricSources([
        "Alpha=http://alpha.example:6012/flat",
        "no-equals-sign",
        "=http://nolabel.example/flat",
        "Beta=ftp://beta.example/flat",
        "Gamma = https://gamma.example/flat ",
        "Alpha=http://alpha.example:6012/flat",
      ]),
    ).toEqual([
      { label: "Alpha", url: "http://alpha.example:6012/flat" },
      { label: "Gamma", url: "https://gamma.example/flat" },
    ]);
  });

  it("is empty for a preset with no binding", () => {
    expect(parseMetricSources(undefined)).toEqual([]);
  });
});

describe("readingsFromFlat", () => {
  it("takes CPU first, then GPUs in index order, rounded", () => {
    expect(
      readingsFromFlat({
        id: "host",
        "cpu.used_percentage": 12,
        "temp.gpu.1.celsius": 61.6,
        "temp.cpu.celsius": 71.4,
        "temp.gpu.0.celsius": 40,
      }),
    ).toEqual([
      { key: "temp.cpu.celsius", part: "CPU", celsius: 71 },
      { key: "temp.gpu.0.celsius", part: "GPU 0", celsius: 40 },
      { key: "temp.gpu.1.celsius", part: "GPU 1", celsius: 62 },
    ]);
  });

  it("names a single GPU plainly and leaves out non-numbers", () => {
    expect(readingsFromFlat({ "temp.gpu.celsius": 45, "temp.cpu.celsius": null })).toEqual([
      { key: "temp.gpu.celsius", part: "GPU", celsius: 45 },
    ]);
    expect(readingsFromFlat("not json")).toEqual([]);
  });
});

describe("gaugeFraction", () => {
  it("fills against 100 C, clamped", () => {
    expect(gaugeFraction(85)).toBeCloseTo(0.85);
    expect(gaugeFraction(130)).toBe(1);
    expect(gaugeFraction(-5)).toBe(0);
    expect(gaugeFraction(null)).toBe(0);
  });
});

describe("gaugeIsHot", () => {
  it("is hot from 85 C on a GPU and 90 C on a CPU", () => {
    expect(gaugeIsHot("GPU", 84)).toBe(false);
    expect(gaugeIsHot("GPU", 85)).toBe(true);
    expect(gaugeIsHot("GPU 1", 85)).toBe(true);
    expect(gaugeIsHot("CPU", 89)).toBe(false);
    expect(gaugeIsHot("CPU", 90)).toBe(true);
  });

  it("is never hot without a reading", () => {
    expect(gaugeIsHot("GPU", null)).toBe(false);
    expect(gaugeIsHot("CPU", Number.NaN)).toBe(false);
  });
});
