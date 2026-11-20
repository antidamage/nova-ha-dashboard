/**
 * "Feels like" (specs/outside-weather-and-map.md, Feels like).
 *
 * The earlier formula was the Bureau of Meteorology's shade apparent
 * temperature, T + 0.33e - 0.70v - 4.00. Its -4 is a calibration constant for a
 * reference day, so on a mild day it reads about three degrees under the air
 * temperature whatever the humidity, and it has no wind-chill model at all.
 *
 * The figure now follows the two scales weather services publish:
 *  - wind chill (the JAG/TI formula MetService and Environment Canada use) when
 *    it is cool and there is wind;
 *  - humidex (Environment Canada) when it is warm and humid, which only ever
 *    raises the figure, so a humid, windless day feels hotter than the air;
 *  - a linear hand-over between 10 and 20 C so the figure has no step in it.
 * Between those the figure is the air temperature.
 */

/** JAG/TI wind chill is defined for wind of 4.8 km/h and up. */
const WIND_CHILL_MIN_KMH = 4.8;
const BLEND_FROM_C = 10;
const BLEND_TO_C = 20;

export function windChillCelsius(temperature: number, windKmh: number): number {
  const gust = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * temperature - 11.37 * gust + 0.3965 * temperature * gust;
}

/** Humidex: air temperature plus the vapour pressure above 10 hPa, from relative humidity. */
export function humidexCelsius(temperature: number, humidity: number): number {
  const saturation = 6.112 * Math.exp((17.62 * temperature) / (243.12 + temperature));
  const vapourPressure = (Math.min(100, Math.max(0, humidity)) / 100) * saturation;
  return temperature + 0.5555 * (vapourPressure - 10);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function feelsLikeCelsius(temperature: number, humidity: number | null, windKmh: number | null): number {
  const coolWeight = clamp01((BLEND_TO_C - temperature) / (BLEND_TO_C - BLEND_FROM_C));
  const warmWeight = clamp01((temperature - BLEND_FROM_C) / (BLEND_TO_C - BLEND_FROM_C));
  const chill =
    windKmh !== null && windKmh >= WIND_CHILL_MIN_KMH ? Math.min(0, windChillCelsius(temperature, windKmh) - temperature) : 0;
  const heat = humidity !== null ? Math.max(0, humidexCelsius(temperature, humidity) - temperature) : 0;
  return temperature + chill * coolWeight + heat * warmWeight;
}
