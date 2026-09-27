import { describe, expect, it } from "vitest";
import { washHeatUp, washTemperature, type WashTemperatureConfig } from "./wash-temperature";

/**
 * What a wash's temperature is read from (specs/power-meters.md §5.3).
 *
 * The fixtures are this machine's own washes, sample for sample as the meter kept
 * them: the two plateaus it has produced, and traces with no element in them at
 * all. A plateau is what the heater's own run looks like between its first and
 * last sample at the element's draw, so these are written as seconds and watts at
 * the ~10 s sampling the meter runs at.
 *
 * The calibration the config carries is derived from the first two: 487 s at
 * 2.19 kW was a 40° wash, and 899 s at 2.16 kW was a 60°.
 */

const CONFIG: WashTemperatureConfig = {
  heaterWatts: 1500,
  inletDegrees: 15,
  minimumSeconds: 120,
  options: [20, 30, 40, 60, 90],
  secondsPerDegree: 19.5,
};

/**
 * A plateau of exactly `plateauSeconds` at `watts`, in the quiet of a wash around
 * it: the samples either side are the fill and the agitation, which draw tens of
 * watts. Only the plateau's two ends matter, so the fixture places them exactly.
 */
function wash(plateauSeconds: number, watts: number, lead = 300, tail = 300) {
  const points: Array<[number, number]> = [];
  for (let at = 0; at < lead; at += 10) points.push([at, 18]);
  points.push([lead, watts], [lead + plateauSeconds, watts]);
  for (let at = lead + plateauSeconds + 10; at < lead + plateauSeconds + tail + 10; at += 10) {
    points.push([at, 24]);
  }
  return points;
}

describe("the heat-up a trace shows", () => {
  it("measures the run between its first and last sample at the element's draw", () => {
    expect(washHeatUp(wash(487, 2190), CONFIG.heaterWatts)).toEqual({ seconds: 487, watts: 2190 });
  });

  it("takes the longest run, not the first: a held temperature re-heats in bursts", () => {
    // The heat-up, then a short top-up later in the cycle: the rise belongs to the
    // first, and the top-up must not be mistaken for a second one.
    const points: Array<[number, number]> = [
      [0, 18],
      [10, 2200],
      [1010, 2200],
      [1020, 24],
      [1500, 2200],
      [1560, 2200],
      [1570, 24],
    ];

    expect(washHeatUp(points, CONFIG.heaterWatts)).toEqual({ seconds: 1000, watts: 2200 });
  });
});

describe("the temperature a wash was set to", () => {
  it("reads a 487 s heat-up as the 40° cycle it was", () => {
    // The labelled example: this one was a 40° wash, and the config's calibration
    // is what turns its own heat-up into that answer.
    const temperature = washTemperature(wash(487, 2190), CONFIG, { complete: true });

    expect(temperature.source).toBe("degrees");
    expect(temperature.degrees).toBe(40);
    expect(temperature.heatUp.watts).toBe(2190);
  });

  it("reads the 899 s heat-up this machine also produced as a 60° cycle", () => {
    // The other hot wash in the store, and the check on the model: nothing was
    // tuned to make this come out, the 40° calibration simply predicts it.
    expect(washTemperature(wash(899, 2160), CONFIG, { complete: true }).degrees).toBe(60);
  });

  it("snaps a measured rise to the buttons the machine has", () => {
    // A rise between two options is one of them: the reader wants the cycle, not
    // the degree. The boundary between 40 and 60 sits at 50 °C — 35° of rise, 682 s
    // — so a heat-up just under it stays 40 and one just over it is 60.
    const between = washTemperature(wash(680, 2200), CONFIG, { complete: true });
    const other = washTemperature(wash(690, 2200), CONFIG, { complete: true });

    expect(between.degrees).toBe(40);
    expect(other.degrees).toBe(60);
  });

  it("calls a finished wash with no element at all cold", () => {
    const temperature = washTemperature([[0, 18], [600, 24], [1200, 400], [1800, 18]], CONFIG, { complete: true });

    expect(temperature.source).toBe("cold");
    expect(temperature.degrees).toBeNull();
    expect(temperature.heatUp.seconds).toBe(0);
  });

  it("says nothing about a wash still running that has not heated yet", () => {
    // The heat-up lands 11 to 14 minutes in, so a running wash with no plateau may
    // be a cold cycle or one whose element has not started: unmeasured, never cold.
    const temperature = washTemperature([[0, 18], [600, 24]], CONFIG, { complete: false });

    expect(temperature.source).toBe("unmeasured");
    expect(temperature.degrees).toBeNull();
  });

  it("still names the temperature of a running wash whose element has already run", () => {
    const temperature = washTemperature(wash(487, 2190, 100, 0), CONFIG, { complete: false });

    expect(temperature.degrees).toBe(40);
  });

  it("ignores a top-up too short to be a heat-up", () => {
    // 60 s at the element's draw is the water being kept warm, not brought up.
    const temperature = washTemperature(wash(60, 2200), CONFIG, { complete: true });

    expect(temperature.source).toBe("cold");
  });

  it("says nothing at all about a wash whose trace kept no samples", () => {
    const temperature = washTemperature([], CONFIG, { complete: true });

    expect(temperature.source).toBe("unmeasured");
    expect(temperature.heatUp).toEqual({ seconds: 0, watts: 0 });
  });
});
