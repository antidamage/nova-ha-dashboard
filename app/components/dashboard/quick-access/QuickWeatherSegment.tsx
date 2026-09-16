"use client";

import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { WeatherStatus } from "../../../../lib/types";
import { formatWeatherNumber, weatherLabel } from "../shared";
import { QuickSegment, SegmentTitle } from "./QuickSegment";

const WEATHER_ICONS: Array<[RegExp, LucideIcon]> = [
  [/lightning|thunder/, CloudLightning],
  [/snow|hail/, CloudSnow],
  [/rain|pouring|drizzle|shower/, CloudRain],
  [/fog|mist|haze/, CloudFog],
  [/wind/, Wind],
  [/night/, Moon],
  [/partly|partial/, CloudSun],
  [/cloud|overcast/, Cloud],
  [/sun|clear/, Sun],
];

export function weatherIcon(condition: string | undefined): LucideIcon {
  const text = (condition ?? "").toLowerCase();
  return WEATHER_ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? Cloud;
}

/** Outside: condition, temperature, feels-like and UV. */
export function QuickWeatherSegment({ weather }: { weather: WeatherStatus | null | undefined }) {
  const Icon = weatherIcon(weather?.condition);

  return (
    <QuickSegment className="quick-segment-weather" label="Outside weather">
      <div className="quick-segment-lead">
        <Icon className="quick-weather-icon" aria-hidden="true" />
        <SegmentTitle title="Outside" state={weather ? weatherLabel(weather.condition) : "Unavailable"} />
      </div>
      {/* The three readings stay one row of their own, so the stacked segment
          puts them together beneath the icon rather than one per line. */}
      <div className="quick-weather-readings">
        <div className="quick-current">
          <span className="quick-stepper-caption">Temp</span>
          <span className="quick-current-number">
            {formatWeatherNumber(weather?.temperature ?? null, 1)}
            {weather?.temperature == null ? null : <span className="quick-access-degree">&deg;</span>}
          </span>
        </div>
        <div className="quick-current">
          <span className="quick-stepper-caption">Feels</span>
          <span className="quick-current-number">
            {formatWeatherNumber(weather?.feelsLike ?? null, 1)}
            {weather?.feelsLike == null ? null : <span className="quick-access-degree">&deg;</span>}
          </span>
        </div>
        <div className="quick-current">
          <span className="quick-stepper-caption">UV</span>
          <span className="quick-current-number">{formatWeatherNumber(weather?.uvIndex ?? null, 1)}</span>
        </div>
      </div>
    </QuickSegment>
  );
}
