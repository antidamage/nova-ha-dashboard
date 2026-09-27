import { describe, expect, it } from "vitest";
import { washHeatUp, washTemperature, type WashTemperatureConfig } from "./wash-temperature";

/**
 * What a wash's temperature is read from (specs/power-meters.md §5.3).
 *
 * The fixtures are this machine's own washes, sample for sample as the meter kept
 * them: the two plateaus it has produced, and traces with no element in them at
 * all. The meter writes one point per tick — about every ten seconds here — so a
 * plateau is a run of samples, never two ends with nothing between them.
 *
 * The calibration the config carries is derived from the first two, labelled by
 * the person who ran them: 899 s of element at 2.16 kW (the wash of 19 September)
 * was a 40° cycle, and 487 s at 2.19 kW (25 September) a 30° — an 18 °C fill at
 * about 41 s of heating per degree of rise.
 */

const CONFIG: WashTemperatureConfig = {
  heaterWatts: 1500,
  heatUpBySeconds: 1080,
  inletDegrees: 18,
  minimumSeconds: 60,
  options: [20, 30, 40, 60, 90],
  secondsPerDegree: 41,
};

/** The gap limit the wash's own timer trusts, which the samples are read with. */
const MAX_GAP = 90;

/** The element on from `from` to `to`, sampled the way the meter samples it. */
function element(from: number, to: number, watts = 2200): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let at = from; at <= to; at += 10) points.push([at, watts]);
  return points;
}

/** A wash: quiet either side, with the element's own run inside it. */
function wash(plateauSeconds: number, watts: number, lead = 300, tail = 300) {
  const end = lead + plateauSeconds;
  const points: Array<[number, number]> = [];
  for (let at = 0; at < lead; at += 10) points.push([at, 18]);
  for (let at = lead; at <= end; at += 10) points.push([at, watts]);
  if (points[points.length - 1][0] !== end) points.push([end, watts]);
  for (let at = end + 10; at <= end + tail + 10; at += 10) points.push([at, 24]);
  return points;
}

const read = (points: Array<[number, number]>, complete = true) =>
  washTemperature(points, CONFIG, { complete, maxGapSeconds: MAX_GAP });

describe("the heat-up a trace shows", () => {
  it("measures the run between its first and last sample at the element's draw", () => {
    expect(washHeatUp(wash(487, 2190), CONFIG, MAX_GAP)).toEqual({ open: false, seconds: 487, watts: 2190 });
  });

  it("takes the longest run, not the first", () => {
    // The cycle's heat-up, then a shorter burst while the machine holds the
    // temperature. The rise belongs to the longer one.
    const points: Array<[number, number]> = [...element(10, 1010), [1020, 24], [1030, 24], ...element(1040, 1100)];

    expect(washHeatUp(points, CONFIG, MAX_GAP)).toEqual({ open: false, seconds: 1000, watts: 2200 });
  });

  it("does not join two runs across a sampling gap", () => {
    // The meter reports nothing about the stretch it did not observe, so the same
    // element draw either side of a longer gap than the timer trusts is two runs:
    // without that, these samples read as one 990 s heat-up instead of 300 s.
    const points: Array<[number, number]> = [...element(10, 110), ...element(700, 1000), [1010, 24]];

    expect(washHeatUp(points, CONFIG, MAX_GAP)).toEqual({ open: false, seconds: 300, watts: 2200 });
  });

  it("reports a run that is still going in the wash's last sample as open", () => {
    expect(washHeatUp(element(10, 400), CONFIG, MAX_GAP)).toEqual({ open: true, seconds: 390, watts: 2200 });
  });
});

describe("the temperature a wash was set to", () => {
  it("reads the 899 s heat-up of 19 September as the 40° cycle it was", () => {
    // The wash the owner has the label for, and the config's calibration is what
    // turns its own heat-up into that answer.
    const temperature = read(wash(899, 2160));

    expect(temperature.source).toBe("degrees");
    expect(temperature.degrees).toBe(40);
    expect(temperature.heatUp.watts).toBe(2160);
  });

  it("reads the 487 s heat-up of 25 September as the 30° cycle it was", () => {
    // The other hot wash in the store. Her reading of the pair is what makes it 30
    // rather than 20: 487 s as 20° would need the mains to fill below freezing.
    expect(read(wash(487, 2190)).degrees).toBe(30);
  });

  it("reads the 20° button, whose heat-up is under two minutes", () => {
    // 18 + 82 / 41 = 20° of rise. The coolest cycle the machine offers heats for
    // less than the element's own top-up bursts, so its floor sits well below them.
    const temperature = read(wash(82, 2200));

    expect(temperature.degrees).toBe(20);
    expect(temperature.heatUp.seconds).toBe(82);
  });

  it("snaps a measured rise to the buttons the machine has", () => {
    // A rise between two options is one of them: the reader wants the cycle, not the
    // degree. The boundary between 30 and 40 sits at 35 °C — 17° of rise, 697 s — so
    // a heat-up just under it stays 30 and one just over it is 40.
    expect(read(wash(690, 2200)).degrees).toBe(30);
    expect(read(wash(700, 2200)).degrees).toBe(40);
  });

  it("prefers the cycle's own heat-up to a longer re-heat later in the wash", () => {
    // The burst that holds a temperature can outlast a short heat-up, and the water
    // is hot by then: only the run near the start is the load being brought up.
    const points: Array<[number, number]> = [...wash(487, 2190, 300, 0), [800, 24], [810, 24], ...element(2000, 2700)];

    expect(read(points).degrees).toBe(30);
  });

  it("ignores an element run that starts long after the cycle's heat-up would have", () => {
    // 40 minutes in, the element running for ten minutes is the machine keeping a
    // temperature, not bringing a load up — so this wash is a cold one.
    const temperature = read(wash(600, 2200, 2400));

    expect(temperature.source).toBe("cold");
    expect(temperature.heatUp.seconds).toBe(0);
  });

  it("calls a finished wash with no element at all cold", () => {
    const temperature = read([[0, 18], [600, 24], [1200, 400], [1800, 18]]);

    expect(temperature.source).toBe("cold");
    expect(temperature.degrees).toBeNull();
    expect(temperature.heatUp.seconds).toBe(0);
  });

  it("says nothing about a wash still running that has not heated yet", () => {
    // The heat-up lands 11 to 14 minutes in, so a running wash with no plateau may
    // be a cold cycle or one whose element has not started: unmeasured, never cold.
    const temperature = read([[0, 18], [600, 24]], false);

    expect(temperature.source).toBe("unmeasured");
    expect(temperature.degrees).toBeNull();
  });

  it("says nothing about a running wash whose element is still on", () => {
    // The rise is partial while the water is still coming up, and a partial rise
    // names a cooler cycle than the one that was chosen.
    const temperature = read(element(10, 400), false);

    expect(temperature.source).toBe("unmeasured");
    expect(temperature.heatUp.open).toBe(true);
  });

  it("still names the temperature of a running wash whose element has finished", () => {
    expect(read(wash(899, 2160, 100, 200), false).degrees).toBe(40);
  });

  it("ignores a top-up too short to be a heat-up, having measured it", () => {
    // 40 s of element is the meter catching a blip, whatever it drew — and the run
    // is still measured, so this passes because it was rejected, not because the
    // classifier never saw it.
    const temperature = read(wash(40, 2200));

    expect(temperature.heatUp.seconds).toBe(40);
    expect(temperature.source).toBe("cold");
  });

  it("counts a run at the floor itself as a heat-up", () => {
    // minimumSeconds is inclusive, so 60 s of element is the shortest run that
    // counts: 18 + 60 / 41 rounds to the 20° button.
    expect(read(wash(60, 2200)).degrees).toBe(20);
  });

  it("says nothing at all about a wash whose trace kept no samples", () => {
    const temperature = read([]);

    expect(temperature.source).toBe("unmeasured");
    expect(temperature.heatUp).toEqual({ open: false, seconds: 0, watts: 0 });
  });
});
