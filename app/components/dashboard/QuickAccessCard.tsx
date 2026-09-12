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
  Moon,
  PowerOff,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
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
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { AirconKnob, HeaterKnob } from "./ClimateKnobs";
import { useClimateCardTitles, type EntityActionsHandler } from "./climateCommands";
import { adaptiveCandlelightLabel } from "./lighting";
import { lightsOnLabel } from "./quickAccessModel";
import {
  classNames,
  climateDevicesForZone,
  dashboardEntityIsOn,
  formatWeatherNumber,
  weatherLabel,
  type BedroomHeaterDevices,
} from "./shared";
import { useZoneLighting, type ZoneActionHandler } from "./useZoneLighting";
import { ZoneColorEncoder } from "./ZoneControls";

const QUICK_ENCODER_SIZE = 56;
/** The temperature knob's floor: it is unusable smaller (Adeline, 2026-09-12). */
const QUICK_TEMPERATURE_SIZE = 100;

function QuickSegment({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={classNames("quick-segment", className)} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * A climate knob and its name, and no tile around it. The knob's dial is 124px
 * across where a tile's row is 84px, so boxing one made it overflow its own
 * border and collide with the tile below in the landscape grid. The two climate
 * knobs sit inline in `quick-climate-row` instead, each under its own label
 * (Adeline, 2026-09-12).
 */
function QuickClimate({ children, label, title }: { children: ReactNode; label: string; title: string }) {
  return (
    <div className="quick-climate quick-segment-climate" role="group" aria-label={label}>
      <span className="quick-segment-title">{title}</span>
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
 * The climate segments' stepper, current-temperature readout and Auto/Off pair
 * are gone: the temperature knob carries all three (Adeline, 2026-09-12,
 * specs/temperature-encoder.md).
 */

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

/**
 * The lounge air conditioner: the room's name and a 100px temperature knob
 * (Adeline, 2026-09-12). The stepper, the state word and the Auto/Off buttons
 * are all on the knob now — see specs/temperature-encoder.md. Its rings float
 * over the page, so the tile is only as tall as the knob.
 */
export function QuickAirconSegment({
  climateControl,
  entity,
  freshAirSwitch,
  preferences,
  quietSwitch,
  title,
  turboSwitch,
  onEntityActions,
}: {
  climateControl?: ClimateControlState;
  entity: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  return (
    <QuickClimate label={`${title} air conditioner`} title={title}>
      <AirconKnob
        climateControl={climateControl?.lounge}
        entity={entity}
        freshAirSwitch={freshAirSwitch}
        preferences={preferences}
        quietSwitch={quietSwitch}
        size={QUICK_TEMPERATURE_SIZE}
        title={title}
        turboSwitch={turboSwitch}
        onEntityActions={onEntityActions}
      />
    </QuickClimate>
  );
}

/** The bedroom heater: the room's name and a 100px temperature knob. */
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
  return (
    <QuickClimate label={`${title} heater`} title={title}>
      <HeaterKnob
        humidity={devices.humidity}
        preferences={preferences}
        size={QUICK_TEMPERATURE_SIZE}
        switchEntity={devices.switchEntity}
        temperature={devices.temperature ?? null}
        title={title}
        onNotice={onNotice}
      />
    </QuickClimate>
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
  const { aircon, freshAirSwitch, quietSwitch, turboSwitch } = climateDevicesForZone(climateZone);
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
        {aircon || (bedroomHeater && heaterSwitch) ? (
          <div className="quick-climate-row">
            {aircon ? (
              <QuickAirconSegment
                climateControl={climateControl}
                entity={aircon}
                freshAirSwitch={freshAirSwitch}
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
          </div>
        ) : null}
        <QuickWeatherSegment weather={weather} />
      </div>
    </section>
  );
}
