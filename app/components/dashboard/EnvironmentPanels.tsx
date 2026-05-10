"use client";

import { Droplets, Thermometer } from "lucide-react";
import { formatHumidity, formatTemperature, type LoungeEnvironment } from "./shared";

export function LoungeEnvironmentPanel({ environment }: { environment: LoungeEnvironment | null }) {
  const hasSensorEntity = Boolean(environment?.temperatureEntity || environment?.humidityEntity);
  const hasSensorValue = environment?.temperature !== null || environment?.humidity !== null;
  const statusLabel = hasSensorEntity ? (hasSensorValue ? "Live" : "Offline") : "Missing";

  return (
    <section className="lounge-environment-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">Lounge Sensor</p>
          <h2 className="mt-1 truncate text-3xl font-black uppercase text-neutral-50">Environment</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          {statusLabel}
        </div>
      </header>

      <div className="lounge-environment-grid grid gap-3">
        <div className="lounge-environment-metric border border-neutral-700 bg-neutral-950/70 p-4">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-neutral-400">
            <Thermometer className="h-4 w-4 text-cyan-300" />
            Temperature
          </p>
          <p className="mt-2 font-mono text-4xl font-black tabular-nums text-neutral-50">
            {formatTemperature(environment?.temperature ?? null)}
            <span className="text-lg">&deg;</span>
          </p>
        </div>
        <div className="lounge-environment-metric border border-neutral-700 bg-neutral-950/70 p-4">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-neutral-400">
            <Droplets className="h-4 w-4 text-cyan-300" />
            Humidity
          </p>
          <p className="mt-2 font-mono text-4xl font-black tabular-nums text-neutral-50">
            {formatHumidity(environment?.humidity ?? null)}
            <span className="ml-1 text-lg text-neutral-400">%</span>
          </p>
        </div>
      </div>
    </section>
  );
}

export function BedroomTemperaturePanel({ temperature }: { temperature: number | null }) {
  return (
    <section className="lounge-environment-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">Bedroom</p>
          <h2 className="mt-1 truncate text-3xl font-black uppercase text-neutral-50">Temperature</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          Panel Heater
        </div>
      </header>

      <div className="lounge-environment-metric border border-neutral-700 bg-neutral-950/70 p-4">
        <p className="flex items-center gap-2 text-xs font-black uppercase text-neutral-400">
          <Thermometer className="h-4 w-4 text-cyan-300" />
          Current Room
        </p>
        <p className="mt-2 font-mono text-4xl font-black tabular-nums text-neutral-50">
          {formatTemperature(temperature)}
          <span className="text-lg">&deg;</span>
        </p>
      </div>
    </section>
  );
}
