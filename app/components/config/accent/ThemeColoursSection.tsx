"use client";

import type { ReactNode } from "react";
import { SliderControlPanel } from "../../ConfigControls";
import { SwitchRow } from "../../SlideSwitch";
import { LIGHTING_TINT_STRENGTH_MAX, LIGHTING_TINT_STRENGTH_MIN } from "../../accentColor";
import type { DeviceTheme } from "../../theme/accent/types";
import {
  CLOCK_THEME_SLOT,
  THEME_SLOTS,
  TITLE_THEME_SLOTS,
  VOICE_TRANSCRIPT_THEME_SLOTS,
  type SetConfigTheme,
  type ThemeSlotChoice,
} from "./accent-config-model";
import { TitleToneControl } from "./TitleToneControl";

export function ThemeColoursSection({
  accentRgb,
  highlightRgb,
  renderWidget,
  setTheme,
  theme,
}: {
  accentRgb: [number, number, number];
  highlightRgb: [number, number, number];
  renderWidget: (choice: ThemeSlotChoice) => ReactNode;
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
            <div className="grid gap-3">
              <div className="theme-widget-flow">
                {THEME_SLOTS.map(renderWidget)}
              </div>
              <div className="theme-widget-flow">
                {VOICE_TRANSCRIPT_THEME_SLOTS.map(renderWidget)}
              </div>
              <TitleToneControl
                accentColor={accentRgb}
                highlightColor={highlightRgb}
                value={theme.titleTone}
                onPreview={(titleTone) => setTheme({ ...theme, titleTone }, { persist: false })}
                onCommit={(titleTone) => setTheme({ ...theme, titleTone })}
              />
              <div className="theme-widget-flow">
                {TITLE_THEME_SLOTS.map(renderWidget)}
                {renderWidget(CLOCK_THEME_SLOT)}
              </div>
              <SwitchRow
                checked={theme.lightingTint}
                label="Tint dashboard to match lighting"
                detail={
                  theme.lightingTint
                    ? "Each device follows the zone set under This Device"
                    : "Colours are not affected by the lights"
                }
                onChange={(lightingTint) => setTheme({ ...theme, lightingTint })}
              />
              <SliderControlPanel
                activeColor={highlightRgb}
                ariaLabel="Lighting tint strength"
                ariaValueText={`${theme.lightingTintStrength}%`}
                color={accentRgb}
                label="Tint Strength"
                max={LIGHTING_TINT_STRENGTH_MAX}
                min={LIGHTING_TINT_STRENGTH_MIN}
                step={1}
                value={theme.lightingTintStrength}
                valueText={`${theme.lightingTintStrength}%`}
                onPreview={(lightingTintStrength) => setTheme({ ...theme, lightingTintStrength }, { persist: false })}
                onCommit={(lightingTintStrength) => setTheme({ ...theme, lightingTintStrength })}
              />
            </div>
  );
}
