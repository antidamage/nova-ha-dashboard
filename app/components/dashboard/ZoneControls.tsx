"use client";

import { Flame, Power, PowerOff, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardPreferences,
  DashboardZone,
  RouterStatus,
  SpectrumCursor,
  SunStatus,
  WeatherStatus,
} from "../../../lib/types";
import type { EntityActionInput } from "../../../lib/aircon-control";
import { DotLineControl, DotSpectrumControl } from "../DotControls";
import { BedroomTemperaturePanel, LoungeEnvironmentPanel } from "./EnvironmentPanels";
import { IconButton } from "./IconButton";
import { OutsideControls } from "./OutsideControls";
import { RouterPanel } from "./RouterPanel";
import { ClimateControls } from "./ClimateControls";
import { StatChip } from "./ZoneButton";
import {
  classNames,
  countDomainsForZone,
  dashboardEntityIsOn,
  isBedroomZone,
  isClimateZone,
  isLoungeZone,
  isNetworkZone,
  isOutsideZone,
  type LoungeEnvironment,
} from "./shared";
import {
  CANDLELIGHT_SPECTRUM,
  LIGHT_DRAG_COMMAND_INTERVAL_MS,
  SPECTRUM_LOCAL_HOLD_MS,
  WHITE_SPECTRUM,
  adaptiveCandlelightLabel,
  adaptiveCandlelightSpectrum,
  candlelightBrightnessPct,
  spectrumFromZone,
  spectrumRgbAtPosition,
  spectrumWithCursor,
  useReducedDragCommand,
  type SpectrumValue,
} from "./lighting";

function SpectrumPad({
  disabled,
  brightness,
  value,
  onValueChange,
  onPick,
}: {
  disabled: boolean;
  brightness: number;
  value: SpectrumValue;
  onValueChange: (value: SpectrumValue) => void;
  onPick: (rgb: [number, number, number], cursor: SpectrumCursor) => void;
}) {
  const { flush: flushPickCommand, queue: queuePickCommand } = useReducedDragCommand(
    ({ cursor, rgb }: { cursor: SpectrumCursor; rgb: [number, number, number] }) => onPick(rgb, cursor),
    LIGHT_DRAG_COMMAND_INTERVAL_MS,
  );

  return (
    <div className="relative">
      <DotSpectrumControl
        ariaLabel="Zone color spectrum"
        cursor={value.cursor}
        disabled={disabled}
        intensity={brightness}
        rgbAtPosition={spectrumRgbAtPosition}
        onChange={(cursor, rgb) => {
          onValueChange({ cursor, preview: rgb });
          queuePickCommand({ cursor, rgb });
        }}
        onCommit={() => {
          flushPickCommand();
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-300">
        <span className="uppercase text-fuchsia-200">Spectrum</span>
        <span className="tabular-nums text-neutral-400">brightness {brightness}%</span>
      </div>
    </div>
  );
}

function IntensityControl({
  brightness,
  color,
  disabled,
  onBrightnessChange,
  onBrightnessCommit,
}: {
  brightness: number;
  color: [number, number, number];
  disabled: boolean;
  onBrightnessChange: (value: number) => void;
  onBrightnessCommit: (value: number) => void;
}) {
  const { flush: flushBrightnessCommand, queue: queueBrightnessCommand } = useReducedDragCommand(
    onBrightnessCommit,
    LIGHT_DRAG_COMMAND_INTERVAL_MS,
  );

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_96px] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Intensity</p>
        <div className="px-1">
          <DotLineControl
            ariaLabel="Brightness"
            color={color}
            disabled={disabled}
            intensity={brightness}
            max={100}
            min={0}
            step={1}
            value={brightness}
            onChange={(value) => {
              onBrightnessChange(value);
              queueBrightnessCommand(value);
            }}
            onCommit={flushBrightnessCommand}
          />
        </div>
        <p className="text-4xl font-black tabular-nums text-neutral-50 md:text-right">{Math.round(brightness)}%</p>
      </div>
    </div>
  );
}

export function ZoneControls({
  bedroomTemperature,
  loungeEnvironment,
  sun,
  zone,
  onEntityActions,
  onZoneAction,
  preferences,
  router,
  spectrumCursor,
  weather,
}: {
  bedroomTemperature?: number | null;
  loungeEnvironment?: LoungeEnvironment | null;
  sun?: SunStatus | null;
  zone: DashboardZone;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
  onZoneAction: (action: string, body?: Record<string, unknown>) => Promise<void>;
  preferences?: DashboardPreferences;
  router?: RouterStatus;
  spectrumCursor?: SpectrumCursor;
  weather?: WeatherStatus | null;
}) {
  const [brightness, setBrightness] = useState(zone.brightnessPct);
  const [spectrum, setSpectrum] = useState<SpectrumValue>(
    () => spectrumWithCursor(spectrumFromZone(zone), spectrumCursor) ?? CANDLELIGHT_SPECTRUM,
  );
  const spectrumByZone = useRef<Record<string, SpectrumValue>>({});
  const userSpectrumAtByZone = useRef<Record<string, number>>({});
  const lastZoneId = useRef<string | null>(null);
  const climateZone = isClimateZone(zone);
  const outsideZone = isOutsideZone(zone);
  const networkZone = isNetworkZone(zone);
  const bedroomZone = isBedroomZone(zone);
  const loungeZone = isLoungeZone(zone);
  const lightingZone = !climateZone && !outsideZone && !networkZone;
  const lightEntities = useMemo(
    () => (lightingZone ? zone.entities.filter((entity) => entity.domain === "light") : []),
    [lightingZone, zone.entities],
  );
  const hasLightDevices = lightEntities.length > 0;
  const hasActiveLights = lightEntities.some(dashboardEntityIsOn);
  const statDomains = countDomainsForZone(zone);

  useEffect(() => {
    setBrightness(zone.brightnessPct);
  }, [zone.id, zone.brightnessPct]);

  useEffect(() => {
    const zoneChanged = lastZoneId.current !== zone.id;
    const haSpectrum = spectrumWithCursor(spectrumFromZone(zone), spectrumCursor);
    const recentlyTouched =
      !zoneChanged && Date.now() - (userSpectrumAtByZone.current[zone.id] ?? 0) < SPECTRUM_LOCAL_HOLD_MS;

    lastZoneId.current = zone.id;

    if (haSpectrum && !recentlyTouched) {
      spectrumByZone.current[zone.id] = haSpectrum;
      setSpectrum(haSpectrum);
      return;
    }

    if (zoneChanged) {
      setSpectrum(haSpectrum ?? spectrumByZone.current[zone.id] ?? CANDLELIGHT_SPECTRUM);
    }
  }, [spectrumCursor?.x, spectrumCursor?.y, zone]);

  const rememberSpectrum = useCallback(
    (value: SpectrumValue) => {
      userSpectrumAtByZone.current[zone.id] = Date.now();
      spectrumByZone.current[zone.id] = value;
      setSpectrum(value);
    },
    [zone.id],
  );

  const applyPresetAction = useCallback(
    (action: "on" | "candlelight" | "white") => {
      const nextSpectrum = action === "white" ? WHITE_SPECTRUM : adaptiveCandlelightSpectrum(sun);
      const nextBrightness = action === "white" ? 100 : candlelightBrightnessPct(sun);
      setBrightness(nextBrightness);
      rememberSpectrum(nextSpectrum);
      onZoneAction(action, { brightnessPct: nextBrightness, cursor: nextSpectrum.cursor, rgb: nextSpectrum.preview });
    },
    [onZoneAction, rememberSpectrum, sun],
  );

  const adaptivePresetLabel = adaptiveCandlelightLabel(sun);

  return (
    <section className="zone-panel relative min-h-[620px] border border-neutral-700 bg-neutral-950/70 p-5 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <header className="zone-panel-header flex flex-col gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">Zone Control</p>
          <h1 className="mt-1 text-4xl font-black uppercase text-neutral-50 sm:text-5xl">{zone.name}</h1>
          <div className="zone-stats mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statDomains.map((domain) => (
              <StatChip key={domain} domain={domain} count={zone.counts[domain]} />
            ))}
          </div>
        </div>
        {lightingZone ? (
          <div className="zone-actions grid grid-cols-4 gap-3">
            <IconButton label={`On: ${adaptivePresetLabel}`} disabled={!hasLightDevices} variant="yellow" onClick={() => applyPresetAction("on")}>
              <Power className="h-7 w-7" />
            </IconButton>
            <IconButton
              label={adaptivePresetLabel}
              disabled={!hasLightDevices}
              variant="yellow"
              onClick={() => applyPresetAction("candlelight")}
            >
              <Flame className="h-7 w-7" />
            </IconButton>
            <IconButton
              label="White"
              disabled={!hasLightDevices}
              variant="white"
              onClick={() => applyPresetAction("white")}
            >
              <Sun className="h-7 w-7" />
            </IconButton>
            <IconButton label="Off" disabled={!hasLightDevices && zone.counts.switch === 0} variant="pink" onClick={() => onZoneAction("off")}>
              <PowerOff className="h-7 w-7" />
            </IconButton>
          </div>
        ) : null}
      </header>

      <div className="mt-8 grid gap-5">
        <div className="lighting-column grid gap-5">
          {networkZone ? (
            router ? <RouterPanel router={router} /> : null
          ) : climateZone ? (
            <ClimateControls
              zone={zone}
              loungeEnvironment={loungeEnvironment}
              preferences={preferences}
              onEntityActions={onEntityActions}
            />
          ) : outsideZone ? (
            <OutsideControls zone={zone} weather={weather ?? null} onEntityActions={onEntityActions} />
          ) : (
            <>
              {bedroomZone ? <BedroomTemperaturePanel temperature={bedroomTemperature ?? null} /> : null}
              {loungeZone ? <LoungeEnvironmentPanel environment={loungeEnvironment ?? null} /> : null}
              <SpectrumPad
                disabled={!hasActiveLights}
                brightness={brightness}
                value={spectrum}
                onValueChange={rememberSpectrum}
                onPick={(rgb, cursor) => onZoneAction("color", { rgb, brightnessPct: brightness || 100, cursor })}
              />

              <IntensityControl
                brightness={brightness}
                color={spectrum.preview}
                disabled={!hasLightDevices}
                onBrightnessChange={setBrightness}
                onBrightnessCommit={(value) => onZoneAction("brightness", { brightnessPct: value })}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
