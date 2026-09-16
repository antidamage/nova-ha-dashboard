"use client";

import { SliderControlPanel } from "../../ConfigControls";
import {
  CONTROL_SOUND_VOLUME_DEFAULT,
  CONTROL_SOUND_VOLUME_MAX,
  CONTROL_SOUND_VOLUME_MIN,
  normalizeControlSound,
} from "../../accentColor";
import type { ControlSoundSettings } from "../../theme/accent/types";

export function SoundVolumeConfig({
  color,
  onChange,
  onPreview,
  value,
}: {
  color: [number, number, number];
  onChange: (value: ControlSoundSettings) => void;
  onPreview: (value: ControlSoundSettings) => void;
  value: ControlSoundSettings;
}) {
  const settings = normalizeControlSound(value);

  return (
    <SliderControlPanel
      activeColor={color}
      ariaLabel="UX sound volume"
      ariaValueText={`${settings.volume}%`}
      color={color}
      intensity={settings.volume}
      label="Volume"
      max={CONTROL_SOUND_VOLUME_MAX}
      min={CONTROL_SOUND_VOLUME_MIN}
      step={5}
      value={settings.volume}
      valueText={`${settings.volume}%`}
      onPreview={(volume) => onPreview({ ...settings, volume: Math.round(volume) })}
      onCommit={(volume) => {
        onChange({ ...settings, volume: Math.round(volume) });
      }}
      markers={[
        { active: settings.volume === CONTROL_SOUND_VOLUME_DEFAULT, label: "Default", value: CONTROL_SOUND_VOLUME_DEFAULT },
      ]}
    />
  );
}
