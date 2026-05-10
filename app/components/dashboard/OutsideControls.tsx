"use client";

import dynamic from "next/dynamic";
import { Power } from "lucide-react";
import { Suspense } from "react";
import type { DashboardZone, WeatherStatus } from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { LabeledSwitch } from "./ClimateControls";
import { WeatherPanel } from "./WeatherPanel";

const MapPanel = dynamic(() => import("../MapPanel").then((module) => module.MapPanel), { ssr: false });

export function OutsideControls({
  onEntityActions,
  weather,
  zone,
}: {
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  weather: WeatherStatus | null;
  zone: DashboardZone;
}) {
  const outsideLight =
    zone.entities.find((entity) => entity.domain === "light") ?? zone.entities.find((entity) => entity.isIllumination);
  const isOn = outsideLight ? outsideLight.state === "on" : false;
  const unavailable = outsideLight ? ["unknown", "unavailable"].includes(outsideLight.state) : true;

  const setPower = () => {
    if (!outsideLight) {
      return;
    }

    void onEntityActions(
      [
        {
          entityId: outsideLight.entity_id,
          domain: outsideLight.domain,
          service: isOn ? "turn_off" : "turn_on",
        },
      ],
      `Outside light ${isOn ? "off" : "on"}`,
    );
  };

  return (
    <div className="outside-control-grid grid gap-5">
      <section className="outside-light-card border border-neutral-700 bg-neutral-950/70 p-5">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase text-cyan-300">Exterior Circuit</p>
            <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Outside Light</h2>
          </div>
          <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
            {outsideLight?.state ?? "missing"}
          </div>
        </header>

        <LabeledSwitch
          checked={isOn}
          disabled={unavailable}
          icon={<Power className="h-4 w-4" />}
          label="Outside light power"
          leftLabel="Off"
          rightLabel="On"
          onChange={setPower}
        />
      </section>

      <WeatherPanel weather={weather} />

      <section className="outside-map-panel border border-[var(--cyber-line-dim)] bg-[var(--cyber-panel)]">
        <Suspense fallback={null}>
          <MapPanel className="h-full w-full" />
        </Suspense>
      </section>
    </div>
  );
}
