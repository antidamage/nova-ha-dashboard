import { describe, expect, it } from "vitest";
import { gaugeCells } from "./QuickHostTempsSegment";

const sources = [
  { label: "Alpha", url: "http://a.example/flat" },
  { label: "Beta", url: "http://b.example/flat" },
];

describe("gaugeCells", () => {
  it("draws every reading of each machine in order, labelled", () => {
    const cells = gaugeCells(sources, [
      { ...sources[0], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 71 }, { key: "temp.gpu.celsius", part: "GPU", celsius: 45 }] },
      { ...sources[1], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 53 }] },
    ], false);
    expect(cells.map((c) => [c.label, c.celsius, c.dim])).toEqual([
      ["Alpha CPU", 71, false],
      ["Alpha GPU", 45, false],
      ["Beta CPU", 53, false],
    ]);
  });

  it("keeps an unreachable machine's gauges in place, empty and dimmed", () => {
    const remembered = new Map<string, string[]>();
    gaugeCells(sources, [
      { ...sources[0], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 71 }] },
      { ...sources[1], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 53 }, { key: "temp.gpu.celsius", part: "GPU", celsius: 38 }] },
    ], false, remembered);
    const cells = gaugeCells(sources, [
      { ...sources[0], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 72 }] },
      { ...sources[1], ok: false, readings: [] },
    ], false, remembered);
    expect(cells.map((c) => [c.label, c.celsius, c.dim])).toEqual([
      ["Alpha CPU", 72, false],
      ["Beta CPU", null, true],
      ["Beta GPU", null, true],
    ]);
  });

  it("assumes a CPU and a GPU before the first answer, and dims stale readings", () => {
    expect(gaugeCells(sources.slice(0, 1), undefined, true).map((c) => [c.label, c.celsius, c.dim])).toEqual([
      ["Alpha CPU", null, true],
      ["Alpha GPU", null, true],
    ]);
    const stale = gaugeCells(sources.slice(0, 1), [{ ...sources[0], ok: true, readings: [{ key: "temp.cpu.celsius", part: "CPU", celsius: 60 }] }], true);
    expect(stale[0]).toMatchObject({ celsius: 60, dim: true });
  });
});
