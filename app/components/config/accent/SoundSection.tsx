"use client";

import { SoundLibraryConfig, UxSoundAssignmentsConfig } from "../../UxSoundConfig";
import type { DeviceTheme } from "../../theme/accent/types";
import type { SetConfigTheme } from "./accent-config-model";
import { SoundVolumeConfig } from "./SoundVolumeConfig";

export function SoundSection({
  highlightRgb,
  setTheme,
  theme,
}: {
  highlightRgb: [number, number, number];
  setTheme: SetConfigTheme;
  theme: DeviceTheme;
}) {
  return (
    <>
            <SoundVolumeConfig
              color={highlightRgb}
              value={theme.controlSound}
              onChange={(controlSound) => setTheme({ ...theme, controlSound })}
              onPreview={(controlSound) => setTheme({ ...theme, controlSound }, { persist: false })}
            />
            <UxSoundAssignmentsConfig
              value={theme.uxSounds}
              onChange={(uxSounds) => setTheme({ ...theme, uxSounds })}
            />
            <SoundLibraryConfig />
    </>
  );
}
