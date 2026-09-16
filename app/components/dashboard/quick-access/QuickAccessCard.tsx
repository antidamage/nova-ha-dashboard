"use client";

import { useRef, type CSSProperties } from "react";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  ClimateControlState,
  DashboardZone,
  SpectrumCursor,
  SunStatus,
  WeatherStatus,
} from "../../../../lib/types";
import { ringGeometry } from "../../rotaryEncoderGeometry";
import { useClimateCardTitles, type EntityActionsHandler } from "../climateCommands";
import { climateDevicesForZone, type BedroomHeaterDevices } from "../shared";
import type { ZoneActionHandler } from "../useZoneLighting";
import { quickDialSlot } from "./dial-model";
import { useQuickDialSize } from "./useQuickDialSize";
import { QuickLightsSegment } from "./QuickLightsSegment";
import { QuickAirconSegment, QuickHeaterSegment } from "./QuickClimateSegments";
import { QuickWeatherSegment } from "./QuickWeatherSegment";

export type QuickAccessCardProps = {
  bedroomHeater?: BedroomHeaterDevices;
  climateControl?: ClimateControlState;
  /** The climate zone, which holds the air conditioner and its switches. */
  climateZone?: DashboardZone | null;
  /** The Home zone (`everything`): every light except those excluded in config. */
  homeZone?: DashboardZone | null;
  /** Forwarded to ColorEncoder; see DeviceTheme.knobSkin, specs/color-encoder.md. */
  knobSkin?: "auto" | "dark" | "light";
  preferences?: { aircon?: AirconPreferences; bedroomHeater?: BedroomHeaterPreferences; climateTargetRange?: { min: number; max: number } };
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
  const rowRef = useRef<HTMLDivElement>(null);
  const dialSize = useQuickDialSize(rowRef);
  // Consumed only by the portrait CSS; see globals.css, "Portrait only".
  const rowStyle = {
    "--quick-dial-slot": `${quickDialSlot(dialSize).toFixed(2)}px`,
    "--quick-dial-box": `${ringGeometry(dialSize, 0, true).titleFootprint.toFixed(2)}px`,
  } as CSSProperties;

  return (
    <section className="quick-access" aria-label="Quick Access" data-card-id="quick-access">
      <div ref={rowRef} className="quick-access-row" style={rowStyle}>
        {homeZone ? (
          <QuickLightsSegment knobSkin={knobSkin} size={dialSize} spectrumCursor={spectrumCursor} sun={sun} zone={homeZone} onZoneAction={onHomeZoneAction} />
        ) : null}
        {aircon || (bedroomHeater && heaterSwitch) ? (
          <div className="quick-climate-row">
            {aircon ? (
              <QuickAirconSegment
                climateControl={climateControl}
                entity={aircon}
                freshAirSwitch={freshAirSwitch}
                preferences={preferences?.aircon}
                preferredRange={preferences?.climateTargetRange}
                quietSwitch={quietSwitch}
                size={dialSize}
                title={titles.aircon}
                turboSwitch={turboSwitch}
                onEntityActions={onEntityActions}
              />
            ) : null}
            {bedroomHeater && heaterSwitch ? (
              <QuickHeaterSegment
                devices={{ ...bedroomHeater, switchEntity: heaterSwitch }}
                preferences={preferences?.bedroomHeater}
                preferredRange={preferences?.climateTargetRange}
                size={dialSize}
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
