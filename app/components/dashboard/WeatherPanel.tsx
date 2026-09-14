"use client";

import type { WeatherForecastDay, WeatherStatus } from "../../../lib/types";
import { AdvancedFold } from "./AdvancedFold";
import { formatWeatherNumber, weatherLabel } from "./shared";

export function WeatherPanel({ weather }: { weather: WeatherStatus | null }) {
  if (!weather) {
    return (
      <section className="weather-panel border border-neutral-700 bg-neutral-950/70 p-5">
        <p className="text-sm font-black uppercase text-cyan-300">Weather Feed</p>
        <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Unavailable</h2>
      </section>
    );
  }

  // Today is already in the tiles above; the fold holds the days after it
  // (specs/advanced-fold.md).
  const comingDays = (weather.forecast ?? []).slice(1);

  return (
    <AdvancedFold
      className="weather-panel border border-neutral-700 bg-neutral-950/70 p-5"
      advanced={<WeatherForecastList days={comingDays} />}
    >
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Weather Feed</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{weatherLabel(weather.condition)}</h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-black uppercase text-neutral-400">Feels Like</p>
          <p className="temp-readout num-lg font-mono text-3xl font-black tabular-nums text-neutral-50">
            {formatWeatherNumber(weather.feelsLike, 1)}
            <span className="text-lg">&deg;</span>
          </p>
        </div>
      </header>

      <div className="weather-metric-grid grid gap-3">
        <WeatherMetric label="Now" value={`${formatWeatherNumber(weather.temperature, 1)} C`} isTemperature />
        <WeatherMetric
          label="Min / Max"
          value={`${formatWeatherNumber(weather.low, 0)} / ${formatWeatherNumber(weather.high, 0)} C`}
          isTemperature
        />
        <WeatherMetric label="Rain" value={formatWeatherNumber(weather.rainChancePct, 0)} suffix="%" />
        <WeatherMetric
          label="UV"
          value={`${formatWeatherNumber(weather.uvIndex, 1)} / ${formatWeatherNumber(weather.maxUvIndex, 1)}`}
        />
        <WeatherMetric
          label="Wind"
          value={formatWeatherNumber(weather.windSpeed, 0)}
          suffix={weather.windUnit || "km/h"}
        />
        <WeatherMetric label="Humidity" value={formatWeatherNumber(weather.humidity, 0)} suffix="%" />
      </div>
    </AdvancedFold>
  );
}

function WeatherForecastList({ days }: { days: WeatherForecastDay[] }) {
  if (!days.length) {
    return <p className="advanced-fold-row text-xs font-black uppercase text-neutral-400">No forecast days from Home Assistant</p>;
  }

  return (
    <div className="advanced-fold-row weather-forecast-list grid gap-2">
      {days.map((day, index) => (
        <div key={day.datetime ?? index} className="weather-forecast-day border border-neutral-700 bg-neutral-950/70 p-3">
          <p className="text-xs font-black uppercase text-neutral-400">{forecastDayLabel(day.datetime)}</p>
          <p className="text-sm font-black uppercase text-neutral-50">{weatherLabel(day.condition ?? "unknown")}</p>
          <p className="num-md font-mono text-lg font-black tabular-nums text-neutral-50">
            {formatWeatherNumber(day.low, 0)} / {formatWeatherNumber(day.high, 0)}
            <span className="ml-1 text-sm text-neutral-400">C</span>
          </p>
          <p className="text-xs font-black uppercase text-neutral-400">
            Rain {formatWeatherNumber(day.rainChancePct, 0)}%
          </p>
        </div>
      ))}
    </div>
  );
}

function forecastDayLabel(datetime: string | null) {
  if (!datetime) return "--";
  const at = new Date(datetime);
  if (Number.isNaN(at.getTime())) return "--";
  return at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function WeatherMetric({ isTemperature, label, suffix, value }: { isTemperature?: boolean; label: string; suffix?: string; value: string }) {
  return (
    <div className="weather-metric border border-neutral-700 bg-neutral-950/70 p-4">
      <p className="text-xs font-black uppercase text-neutral-400">{label}</p>
      <p className={`num-md mt-2 font-mono text-2xl font-black uppercase tabular-nums text-neutral-50${isTemperature ? " temp-readout" : ""}`}>
        {value}
        {suffix ? <span className="ml-1 text-sm text-neutral-400">{suffix}</span> : null}
      </p>
    </div>
  );
}
