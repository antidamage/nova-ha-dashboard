"use client";

import type { WeatherStatus } from "../../../lib/types";
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

  return (
    <section className="weather-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Weather Feed</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{weatherLabel(weather.condition)}</h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-black uppercase text-neutral-400">Feels Like</p>
          <p className="font-mono text-3xl font-black tabular-nums text-neutral-50">
            {formatWeatherNumber(weather.feelsLike, 1)}
            <span className="text-lg">&deg;</span>
          </p>
        </div>
      </header>

      <div className="weather-metric-grid grid gap-3">
        <WeatherMetric label="Now" value={`${formatWeatherNumber(weather.temperature, 1)} C`} />
        <WeatherMetric
          label="Min / Max"
          value={`${formatWeatherNumber(weather.low, 0)} / ${formatWeatherNumber(weather.high, 0)} C`}
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
    </section>
  );
}

function WeatherMetric({ label, suffix, value }: { label: string; suffix?: string; value: string }) {
  return (
    <div className="weather-metric border border-neutral-700 bg-neutral-950/70 p-4">
      <p className="text-xs font-black uppercase text-neutral-400">{label}</p>
      <p className="mt-2 font-mono text-2xl font-black uppercase tabular-nums text-neutral-50">
        {value}
        {suffix ? <span className="ml-1 text-sm text-neutral-400">{suffix}</span> : null}
      </p>
    </div>
  );
}
