import { describe, expect, it } from "vitest";
import { feelsLikeCelsius, humidexCelsius, windChillCelsius } from "./feels-like";

describe("feels like (specs/outside-weather-and-map.md)", () => {
  it("matches the published wind chill: -10 C at 20 km/h is about -17.9", () => {
    expect(windChillCelsius(-10, 20)).toBeCloseTo(-17.9, 0);
  });

  it("matches the published humidex: 30 C at 70% humidity is about 41", () => {
    expect(humidexCelsius(30, 70)).toBeGreaterThan(39);
    expect(humidexCelsius(30, 70)).toBeLessThan(43);
  });

  it("a mild day with no wind and ordinary humidity reads as the air temperature, not three under", () => {
    expect(feelsLikeCelsius(18, 50, 0)).toBeCloseTo(18, 0);
    expect(feelsLikeCelsius(15, 60, 2)).toBeGreaterThanOrEqual(14.5);
  });

  it("a humid, windless warm day feels hotter than the air", () => {
    expect(feelsLikeCelsius(26, 80, 0)).toBeGreaterThan(28);
  });

  it("wind makes a cool day feel colder; calm air does not", () => {
    expect(feelsLikeCelsius(5, 70, 30)).toBeLessThan(1);
    expect(feelsLikeCelsius(5, 70, 0)).toBe(5);
  });

  it("is continuous across the 10 to 20 C hand-over", () => {
    for (let t = 9; t < 21; t += 0.5) {
      expect(Math.abs(feelsLikeCelsius(t + 0.1, 70, 15) - feelsLikeCelsius(t, 70, 15))).toBeLessThan(0.6);
    }
  });

  it("works without humidity or wind", () => {
    expect(feelsLikeCelsius(12, null, null)).toBe(12);
  });
});
