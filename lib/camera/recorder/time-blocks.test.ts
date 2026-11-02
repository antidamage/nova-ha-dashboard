import { describe, expect, it } from "vitest";
import { parseTimeBlocks, timeBlockFilters } from "./time-blocks";

describe("parseTimeBlocks", () => {
  it("reads each block and drops a malformed one", () => {
    expect(parseTimeBlocks("672,986,336,44,28; 32,1014,178,30,15;bad;1,2,3;1,2,0,4,5")).toEqual([
      { x: 672, y: 986, width: 336, height: 44, fontSize: 28 },
      { x: 32, y: 1014, width: 178, height: 30, fontSize: 15 },
    ]);
  });

  it("is empty when unset", () => {
    expect(parseTimeBlocks("")).toEqual([]);
  });
});

describe("timeBlockFilters", () => {
  const block = { x: 10, y: 20, width: 100, height: 40, fontSize: 12 };

  it("draws the box, then the clock centred on it", () => {
    const [box, text] = timeBlockFilters([block], "/font.ttf");
    expect(box).toBe("drawbox=x=10:y=20:w=100:h=40:color=black:t=fill");
    expect(text).toContain("fontfile='/font.ttf':fontcolor=white:fontsize=12:x=10+(100-text_w)/2:y=20+(40-text_h)/2:");
    expect(text).toContain("%{localtime\\:%d/%m/%Y %H");
  });

  it("still hides the source's clock with no font", () => {
    expect(timeBlockFilters([block], null)).toHaveLength(1);
  });
});
