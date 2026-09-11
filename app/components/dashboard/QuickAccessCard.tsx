"use client";

/**
 * Quick Access — one line of the controls used most: whole-home light colour,
 * the lounge and bedroom climate at their simplest, and the outside weather.
 * See specs/quick-access-card.md.
 *
 * Everything here is props-driven so another surface can mount the card, or
 * any one segment of it. Commands go through the same hooks and zone actions
 * the full cards use; nothing in this file decides device behaviour.
 */
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Flame,
  Gauge,
  Minus,
  Moon,
  Plus,
  PowerOff,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  ClimateControlState,
  DashboardEntity,
  DashboardZone,
  SpectrumCursor,
  SunStatus,
  WeatherStatus,
} from "../../../lib/types";
import { BEDROOM_HEATER_MAX_TARGET_C, BEDROOM_HEATER_MIN_TARGET_C } from "../../../lib/bedroom-heater-control";
import { airconAutoMeasuredTemperature, airconAutoSupported } from "../../../lib/aircon-control";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { useClimateCardTitles, type EntityActionsHandler } from "./climateCommands";
import { useSharedAirconCommands, useSharedBedroomHeaterCommands } from "./ClimateCommandsProvider";
import { adaptiveCandlelightLabel } from "./lighting";
import { airconStateLabel, heaterStateLabel, lightsOnLabel } from "./quickAccessModel";
import {
  classNames,
  climateDevicesForZone,
  dashboardEntityIsOn,
  formatTemperature,
  formatWeatherNumber,
  temperatureDelta,
  weatherLabel,
  type BedroomHeaterDevices,
} from "./shared";
import { useZoneLighting, type ZoneActionHandler } from "./useZoneLighting";
import { ZoneColorEncoder } from "./ZoneControls";

const QUICK_ENCODER_SIZE = 56;

function Degrees({ value }: { value: number | null | undefined }) {
  const shown = value ?? null;
  return (
    <>
      {formatTemperature(shown)}
      {shown === null ? null : <span className="quick-access-degree">&deg;</span>}
    </>
  );
}

function QuickSegment({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={classNames("quick-segment", className)} role="group" aria-label={label}>
      {children}
    </div>
  );
}

function SegmentTitle({ state, title }: { state: string; title: string }) {
  return (
    <div className="quick-segment-text">
      <span className="quick-segment-title">{title}</span>
      <span className="quick-segment-state">{state}</span>
    </div>
  );
}

function QuickButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Set for toggle-like choices (Auto/Off) so assistive tech reads the selection. */
  pressed?: boolean;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={classNames("quick-button border", active && "quick-button-active")}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </MomentaryFeedbackButton>
  );
}

/**
 * Target temperature with −/+ either side. Same stepping as the full cards'
 * `TemperatureStepper`: entity min/max via `temperatureDelta`, then any
 * caller-supplied Nova bounds on top.
 */
function QuickStepper({
  current,
  disabled,
  entity,
  label,
  max,
  min,
  target,
  onChange,
}: {
  /** Falls back to the room's measured temperature, as TemperatureStepper does. */
  current?: number | null;
  disabled?: boolean;
  entity: DashboardEntity;
  label: string;
  max?: number;
  min?: number;
  target: number | null | undefined;
  onChange: (temperature: number) => void;
}) {
  const [shown, setShown] = useState(target ?? null);

  useEffect(() => {
    setShown(target ?? null);
  }, [target, entity.entity_id]);

  const nudge = (delta: number) => {
    if (disabled) return;
    const stepped = temperatureDelta(entity, delta, 1, shown ?? target ?? current ?? 20);
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, stepped));
    if (next === shown) return;
    setShown(next);
    onChange(next);
  };

  return (
    <div className={classNames("quick-stepper", disabled && "quick-stepper-disabled")}>
      <MomentaryFeedbackButton
        type="button"
        className="quick-stepper-button border"
        aria-label={`Lower ${label} target`}
        disabled={disabled}
        onClick={() => nudge(-1)}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </MomentaryFeedbackButton>
      <div className="quick-stepper-value" aria-live="polite">
        <span className="quick-stepper-caption">Target</span>
        <span className="quick-stepper-number">
          <Degrees value={shown} />
        </span>
      </div>
      <MomentaryFeedbackButton
        type="button"
        className="quick-stepper-button border"
        aria-label={`Raise ${label} target`}
        disabled={disabled}
        onClick={() => nudge(1)}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </MomentaryFeedbackButton>
    </div>
  );
}

function CurrentTemperature({ value }: { value: number | null | undefined }) {
  return (
    <div className="quick-current">
      <span className="quick-stepper-caption">Now</span>
      <span className="quick-current-number">
        <Degrees value={value} />
      </span>
    </div>
  );
}

/** The Home zone's single colour control plus Candlelight and Off. */
export function QuickLightsSegment({
  knobSkin,
  spectrumCursor,
  sun,
  zone,
  onZoneAction,
}: {
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  spectrumCursor?: SpectrumCursor;
  sun?: SunStatus | null;
  zone: DashboardZone;
  onZoneAction: ZoneActionHandler;
}) {
  const lighting = useZoneLighting({ spectrumCursor, sun, zone, onZoneAction });
  const lightEntities = zone.entities.filter((entity) => entity.domain === "light");
  const hasActiveLights = lightEntities.some(dashboardEntityIsOn);
  const presetLabel = adaptiveCandlelightLabel(sun);

  return (
    <QuickSegment className="quick-segment-lights" label={`${zone.name} lights`}>
      <div className="quick-segment-lead">
        <ZoneColorEncoder
          brightness={lighting.brightness}
          className="quick-access-encoder"
          colorEnabled={hasActiveLights}
          disabled={!lighting.hasLightDevices}
          knobSkin={knobSkin}
          label=""
          size={QUICK_ENCODER_SIZE}
          spectrum={lighting.spectrum}
          zoneId={zone.id}
          onBrightnessChange={lighting.setLocalBrightness}
          onBrightnessCommit={(value) => void lighting.commitBrightness(value)}
          onColorCommit={(rgb, brightnessPct, cursor) => void lighting.commitColor(rgb, brightnessPct, cursor)}
          onSpectrumChange={lighting.rememberSpectrum}
        />
        <SegmentTitle title={zone.name} state={lightsOnLabel(zone)} />
      </div>
      <div className="quick-button-pair">
        <QuickButton
          disabled={!lighting.hasLightDevices}
          icon={Flame}
          label={presetLabel}
          onClick={() => void lighting.applyPreset("candlelight")}
        />
        <QuickButton
          disabled={!lighting.hasLightDevices && zone.counts.switch === 0}
          icon={PowerOff}
          label="Off"
          onClick={() => void lighting.turnOff()}
        />
      </div>
    </QuickSegment>
  );
}

/** The lounge air conditioner reduced to Auto/Off, target, current and state. */
export function QuickAirconSegment({
  climateControl,
  entity,
  preferences,
  quietSwitch,
  title,
  turboSwitch,
  onEntityActions,
}: {
  climateControl?: ClimateControlState;
  entity: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  const aircon = useSharedAirconCommands({
    controlState: climateControl?.lounge,
    entity,
    preferences,
    quietSwitch,
    turboSwitch,
    onEntityActions,
  });
  const autoSupported = airconAutoSupported(aircon.supportedModes);

  return (
    <QuickSegment className="quick-segment-climate" label={`${title} air conditioner`}>
      <SegmentTitle title={title} state={airconStateLabel(entity, aircon.activePowerState)} />
      <CurrentTemperature value={airconAutoMeasuredTemperature(entity)} />
      <QuickStepper
        current={airconAutoMeasuredTemperature(entity)}
        disabled={aircon.entityUnavailable || !aircon.isControlOn}
        entity={entity}
        label={title}
        target={aircon.airconSettings.temperature}
        onChange={(next) => void aircon.setTemperature(next)}
      />
      <div className="quick-button-pair">
        <QuickButton
          active={aircon.activePowerState === "auto"}
          disabled={aircon.entityUnavailable || !autoSupported}
          icon={Gauge}
          label="Auto"
          pressed={aircon.activePowerState === "auto"}
          onClick={() => void aircon.choosePowerState("auto")}
        />
        <QuickButton
          active={aircon.activePowerState === "off"}
          disabled={aircon.entityUnavailable}
          icon={PowerOff}
          label="Off"
          pressed={aircon.activePowerState === "off"}
          onClick={() => void aircon.choosePowerState("off")}
        />
      </div>
    </QuickSegment>
  );
}

/** The bedroom heater reduced to Auto/Off, target, current and state. */
export function QuickHeaterSegment({
  devices,
  preferences,
  title,
  onNotice,
}: {
  devices: BedroomHeaterDevices & { switchEntity: DashboardEntity };
  preferences?: BedroomHeaterPreferences;
  title: string;
  onNotice?: (message: string) => void;
}) {
  const heater = useSharedBedroomHeaterCommands({ onNotice, preferences });
  const switchEntity = devices.switchEntity;
  const unavailable = ["unavailable", "unknown"].includes(switchEntity.state);

  return (
    <QuickSegment className="quick-segment-climate" label={`${title} heater`}>
      <SegmentTitle title={title} state={heaterStateLabel(switchEntity, heater.mode)} />
      <CurrentTemperature value={devices.temperature} />
      <QuickStepper
        current={devices.temperature}
        disabled={unavailable || heater.mode === "off"}
        entity={switchEntity}
        label={title}
        max={BEDROOM_HEATER_MAX_TARGET_C}
        min={BEDROOM_HEATER_MIN_TARGET_C}
        target={heater.displayedTarget}
        onChange={(next) => void heater.changeTarget(next)}
      />
      <div className="quick-button-pair">
        <QuickButton
          active={heater.mode === "auto"}
          disabled={unavailable}
          icon={Gauge}
          label="Auto"
          pressed={heater.mode === "auto"}
          onClick={() => void heater.chooseMode("auto")}
        />
        <QuickButton
          active={heater.mode === "off"}
          disabled={unavailable}
          icon={PowerOff}
          label="Off"
          pressed={heater.mode === "off"}
          onClick={() => void heater.chooseMode("off")}
        />
      </div>
    </QuickSegment>
  );
}

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
    </QuickSegment>
  );
}

export type QuickAccessCardProps = {
  bedroomHeater?: BedroomHeaterDevices;
  climateControl?: ClimateControlState;
  /** The climate zone, which holds the air conditioner and its switches. */
  climateZone?: DashboardZone | null;
  /** The Home zone (`everything`): every light except those excluded in config. */
  homeZone?: DashboardZone | null;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  preferences?: { aircon?: AirconPreferences; bedroomHeater?: BedroomHeaterPreferences };
  spectrumCursor?: SpectrumCursor;
  sun?: SunStatus | null;
  weather?: WeatherStatus | null;
  onEntityActions: EntityActionsHandler;
  onHomeZoneAction: ZoneActionHandler;
  onNotice?: (message: string) => void;
};

export function QuickAccessCard({
  bedroomHeater,
  climateControl,
  climateZone,
  homeZone,
  knobSkin,
  preferences,
  spectrumCursor,
  sun,
  weather,
  onEntityActions,
  onHomeZoneAction,
  onNotice,
}: QuickAccessCardProps) {
  const titles = useClimateCardTitles();
  const { aircon, quietSwitch, turboSwitch } = climateDevicesForZone(climateZone);
  const heaterSwitch = bedroomHeater?.switchEntity;

  return (
    <section className="quick-access" aria-labelledby="quick-access-title" data-card-id="quick-access">
      <h2 id="quick-access-title" className="quick-access-kicker">
        Quick Access
      </h2>
      <div className="quick-access-row">
        {homeZone ? (
          <QuickLightsSegment knobSkin={knobSkin} spectrumCursor={spectrumCursor} sun={sun} zone={homeZone} onZoneAction={onHomeZoneAction} />
        ) : null}
        {aircon ? (
          <QuickAirconSegment
            climateControl={climateControl}
            entity={aircon}
            preferences={preferences?.aircon}
            quietSwitch={quietSwitch}
            title={titles.aircon}
            turboSwitch={turboSwitch}
            onEntityActions={onEntityActions}
          />
        ) : null}
        {bedroomHeater && heaterSwitch ? (
          <QuickHeaterSegment
            devices={{ ...bedroomHeater, switchEntity: heaterSwitch }}
            preferences={preferences?.bedroomHeater}
            title={titles.heater}
            onNotice={onNotice}
          />
        ) : null}
        <QuickWeatherSegment weather={weather} />
      </div>
    </section>
  );
}
