"use client";

import type { ReactNode } from "react";
import { SwitchRow } from "../../SlideSwitch";
import type { DeviceTheme } from "../../theme/accent/types";
import {
  MAP_THEME_SLOTS,
  RADAR_THEME_SLOTS,
  type SetConfigTheme,
  type ThemeSlotChoice,
} from "./accent-config-model";
import { RadarPaletteModeControl } from "./RadarPaletteModeControl";

export function MapSection({
  radarHighRgb,
  radarLowRgb,
  renderWidget,
  setTheme,
  theme,
}: {
  radarHighRgb: [number, number, number];
  radarLowRgb: [number, number, number];
  renderWidget: (choice: ThemeSlotChoice) => ReactNode;
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
            <div className="grid gap-3">
              <SwitchRow
                checked={theme.mapSatellite}
                label="Satellite Ground"
                detail={theme.mapSatellite ? "Tinted satellite imagery covers the map ground plane" : "Map ground uses the flat base and land use colours"}
                onChange={(mapSatellite) => setTheme({ ...theme, mapSatellite })}
              />
              <div className="theme-widget-flow">
                {MAP_THEME_SLOTS.map(renderWidget)}
              </div>
              <RadarPaletteModeControl
                lowColor={radarLowRgb}
                highColor={radarHighRgb}
                value={theme.radarPaletteMode}
                onPreview={(radarPaletteMode) => setTheme({ ...theme, radarPaletteMode }, { persist: false })}
                onCommit={(radarPaletteMode) => setTheme({ ...theme, radarPaletteMode })}
              />
              {theme.radarPaletteMode === "custom" ? (
                <div className="theme-widget-flow">
                  {RADAR_THEME_SLOTS.map(renderWidget)}
                </div>
              ) : null}
            </div>
  );
}
