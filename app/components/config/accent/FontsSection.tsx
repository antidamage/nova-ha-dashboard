"use client";

import { FontControl } from "../../FontControl";
import type { DeviceTheme } from "../../theme/accent/types";
import type { SetConfigTheme } from "./accent-config-model";

export function FontsSection({
  accentRgb,
  highlightRgb,
  setTheme,
  theme,
}: {
  accentRgb: [number, number, number];
  highlightRgb: [number, number, number];
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
            <div className="grid gap-4">
              <FontControl
                label="Theme Font"
                preview="Aa"
                sample="Aa Gg 0123"
                value={theme.font}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(font) => setTheme({ ...theme, font })}
                onPreview={(font) => setTheme({ ...theme, font }, { persist: false })}
              />
              <FontControl
                label="Clock Font"
                preview="12"
                sample="12:34"
                value={theme.clockFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(clockFont) => setTheme({ ...theme, clockFont })}
                onPreview={(clockFont) => setTheme({ ...theme, clockFont }, { persist: false })}
              />
              <FontControl
                label="Status Orb Label"
                preview="12"
                sample="12"
                value={theme.gymFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(gymFont) => setTheme({ ...theme, gymFont })}
                onPreview={(gymFont) => setTheme({ ...theme, gymFont }, { persist: false })}
              />
              <FontControl
                label="Voice Transcript"
                preview="Aa"
                sample="Aa Gg 0123"
                value={theme.transcriptFont}
                sliderColor={accentRgb}
                sliderActiveColor={highlightRgb}
                onChange={(transcriptFont) => setTheme({ ...theme, transcriptFont })}
                onPreview={(transcriptFont) => setTheme({ ...theme, transcriptFont }, { persist: false })}
              />
            </div>
  );
}
